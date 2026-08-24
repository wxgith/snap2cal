import type { EditableFieldName, EventDraft, ExtractedField, SourceSpan } from "../domain/event";
import type {
  CandidateConfidence,
  CandidateSegment,
  EventCandidate,
  MultiEventExtractionResult,
} from "../domain/multiEvent";
import { validateEvent } from "../domain/validation";
import { parseEventText, type ParseEventTextOptions } from "../parser";
import { hasDateExpression } from "./patterns";
import { segmentEventText } from "./segmenter";

const EDITABLE_FIELDS: EditableFieldName[] = [
  "title",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
  "location",
  "description",
  "reminderMinutes",
  "allDay",
  "timeZone",
];

interface VirtualPart {
  virtualStart: number;
  virtualEnd: number;
  originalStart: number;
  originalEnd: number;
}

function hasOwnLocation(text: string): boolean {
  return /(?:地点|地址)\s*[：:]|在\s*[^，,；;。\n]+?(?:看|开|参加|进行|举办|上|吃|办(?!公(?:室|楼|区)))/.test(
    text,
  );
}

function buildVirtualText(segment: CandidateSegment): { text: string; parts: VirtualPart[] } {
  let text = "";
  const parts: VirtualPart[] = [];
  const appendMapped = (value: string, source: SourceSpan) => {
    const virtualStart = text.length;
    text += value;
    parts.push({
      virtualStart,
      virtualEnd: text.length,
      originalStart: source.startIndex,
      originalEnd: source.endIndex,
    });
  };
  const separator = () => {
    if (text) text += "\n";
  };

  if (segment.inheritedContext.date && !hasDateExpression(segment.text)) {
    appendMapped(segment.inheritedContext.date.value, segment.inheritedContext.date.source);
  }
  if (segment.inheritedContext.location && !hasOwnLocation(segment.text)) {
    separator();
    text += "地点：";
    appendMapped(segment.inheritedContext.location.value, segment.inheritedContext.location.source);
  }
  separator();
  appendMapped(segment.text, segment.source);
  return { text, parts };
}

function remapSource(source: SourceSpan | undefined, parts: VirtualPart[], original: string) {
  if (!source) return undefined;
  const part = parts.find(
    (candidate) =>
      source.startIndex >= candidate.virtualStart && source.endIndex <= candidate.virtualEnd,
  );
  if (!part) return undefined;
  const startIndex = part.originalStart + source.startIndex - part.virtualStart;
  const endIndex = part.originalStart + source.endIndex - part.virtualStart;
  if (startIndex < part.originalStart || endIndex > part.originalEnd) return undefined;
  return { text: original.slice(startIndex, endIndex), startIndex, endIndex };
}

function remapDraftSources(
  draft: EventDraft,
  segment: CandidateSegment,
  parts: VirtualPart[],
  original: string,
): EventDraft {
  for (const name of EDITABLE_FIELDS) {
    const field = draft[name] as ExtractedField<unknown>;
    field.source = remapSource(field.source, parts, original);
  }
  draft.originalText = segment.text;
  return draft;
}

function confidenceFor(
  segment: CandidateSegment,
  draft: EventDraft,
): {
  confidence: CandidateConfidence;
  reasons: string[];
} {
  const invalid = validateEvent(draft).length > 0;
  const reasons: string[] = [];
  if (invalid) reasons.push("候选缺少必要字段或导出校验未通过");
  const strong = ["bullet", "numbered-item", "explicit-label", "date-prefix"].includes(
    segment.boundaryReason,
  );
  if (strong) reasons.push("由明确列表或完整事件边界识别");
  if (segment.boundaryReason === "shared-context") reasons.push("继承了相邻章节的共享上下文");
  if (segment.boundaryReason === "semicolon") reasons.push("由分号两侧完整事件结构拆分");
  if (segment.boundaryReason === "single-event-fallback") reasons.push("使用单事件回退边界");
  if (invalid) return { confidence: "low", reasons };
  if (strong || segment.boundaryReason === "single-event-fallback")
    return { confidence: "high", reasons };
  return { confidence: "medium", reasons };
}

export function parseCandidateSegment(
  segment: CandidateSegment,
  originalText: string,
  options: ParseEventTextOptions,
): EventCandidate {
  const virtual = buildVirtualText(segment);
  const draft = remapDraftSources(
    parseEventText(virtual.text, options),
    segment,
    virtual.parts,
    originalText,
  );
  const candidateWarnings = [...draft.warnings];
  if (segment.inheritedContext.date && !hasDateExpression(segment.text)) {
    candidateWarnings.push({
      code: "SHARED_DATE_INHERITED",
      message: `已从第 ${segment.inheritedContext.date.source.startIndex} 个字符处的共享标题继承日期“${segment.inheritedContext.date.value}”。`,
      severity: "info",
      relatedField: "startDate",
    });
  }
  if (segment.inheritedContext.location && !hasOwnLocation(segment.text)) {
    candidateWarnings.push({
      code: "SHARED_LOCATION_INHERITED",
      message: `已继承共享地点“${segment.inheritedContext.location.value}”。`,
      severity: "info",
      relatedField: "location",
    });
  }
  const { confidence, reasons } = confidenceFor(segment, draft);
  if (confidence === "low") {
    candidateWarnings.push({
      code: "CANDIDATE_LOW_CONFIDENCE",
      message: "该候选边界或必要字段置信度较低，请人工确认。",
      severity: "warning",
    });
  }
  const valid = validateEvent(draft).length === 0;
  const usesInheritedDate = Boolean(
    segment.inheritedContext.date && !hasDateExpression(segment.text),
  );
  const usesInheritedLocation = Boolean(
    segment.inheritedContext.location && !hasOwnLocation(segment.text),
  );
  return {
    id: `candidate-${segment.id}`,
    segment: {
      ...segment,
      inheritedContext: {
        ...(usesInheritedDate ? { date: segment.inheritedContext.date } : {}),
        ...(usesInheritedLocation ? { location: segment.inheritedContext.location } : {}),
      },
    },
    draft,
    status: confidence === "high" && valid ? "confirmed" : "needs-review",
    selectedForExport: valid && confidence !== "low",
    confidence,
    reasons,
    warnings: candidateWarnings,
    mergedFrom: [],
    manuallyEdited: false,
  };
}

function duplicateKey(candidate: EventCandidate): string {
  const normalize = (value: string) =>
    value.toLocaleLowerCase().replace(/[\s，,；;。:：\-–—_]/g, "");
  return [
    candidate.draft.startDate.value ?? "",
    candidate.draft.startTime.value ?? "全天",
    candidate.draft.endDate.value ?? "",
    candidate.draft.endTime.value ?? "",
    normalize(candidate.draft.title.value),
  ].join("|");
}

function markDuplicates(candidates: EventCandidate[]): boolean {
  let found = false;
  const seen = new Map<string, EventCandidate>();
  for (const candidate of candidates) {
    const key = duplicateKey(candidate);
    if (!candidate.draft.title.value || !candidate.draft.startDate.value) continue;
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, candidate);
      continue;
    }
    const firstLocation = previous.draft.location.value.trim();
    const nextLocation = candidate.draft.location.value.trim();
    if (firstLocation && nextLocation && firstLocation !== nextLocation) continue;
    candidate.duplicateOf = previous.id;
    candidate.warnings.push({
      code: "DUPLICATE_EVENT_CANDIDATE",
      message: `该候选可能与“${previous.draft.title.value}”重复；不会自动删除，请确认导出选择。`,
      severity: "warning",
    });
    found = true;
  }
  return found;
}

export function parseEventCandidates(
  input: string,
  options: ParseEventTextOptions,
): MultiEventExtractionResult {
  const segmented = segmentEventText(input);
  const candidates = segmented.segments.map((segment) =>
    parseCandidateSegment(segment, input, options),
  );
  const warnings = [...segmented.warnings];
  if (!input.trim()) {
    warnings.push({ code: "EMPTY_INPUT", message: "请输入或粘贴活动文本。", severity: "error" });
  } else if (!candidates.length) {
    warnings.push({
      code: "NO_EVENT_CANDIDATE",
      message: "未识别到可审阅的事件候选，请切换单事件模式或修改原文。",
      severity: "error",
    });
  }
  if (candidates.length > 1) {
    warnings.push({
      code: "MULTI_EVENT_DETECTED",
      message: `检测到 ${candidates.length} 个事件候选，请确认后选择导出。`,
      severity: "info",
    });
  }
  if (markDuplicates(candidates)) {
    warnings.push({
      code: "DUPLICATE_EVENT_CANDIDATE",
      message: "检测到可能重复的事件候选，已保留全部候选供人工处理。",
      severity: "warning",
    });
  }
  return {
    originalText: input,
    candidates,
    unassignedText: segmented.unassignedText,
    warnings,
    parseContext: {
      referenceDateTime: options.referenceDateTime.toISOString(),
      timeZone: options.timeZone,
    },
    detectedCount: candidates.length,
    selectedCount: candidates.filter(
      (candidate) => candidate.selectedForExport && candidate.status !== "ignored",
    ).length,
  };
}
