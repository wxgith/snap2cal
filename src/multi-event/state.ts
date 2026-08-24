import type { EditableFieldName, EventDraft, ExtractedField } from "../domain/event";
import type {
  CandidateMergeOperation,
  EventCandidate,
  EventCandidateStatus,
  MultiEventExtractionResult,
} from "../domain/multiEvent";
import { validateEvent } from "../domain/validation";
import type { ParseEventTextOptions } from "../parser";
import { parseCandidateSegment } from "./parser";

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

function recount(result: MultiEventExtractionResult): MultiEventExtractionResult {
  return {
    ...result,
    detectedCount: result.candidates.length,
    selectedCount: result.candidates.filter(
      (candidate) => candidate.selectedForExport && candidate.status !== "ignored",
    ).length,
  };
}

function copyManualFields(source: EventDraft, target: EventDraft): void {
  for (const name of EDITABLE_FIELDS) {
    const previous = source[name] as ExtractedField<unknown>;
    if (!previous.manuallyEdited) continue;
    const next = target[name] as ExtractedField<unknown>;
    Object.assign(next, previous);
  }
}

export function preserveCandidateState(
  previous: MultiEventExtractionResult,
  next: MultiEventExtractionResult,
): MultiEventExtractionResult {
  for (const candidate of next.candidates) {
    const matched = previous.candidates.find(
      (item) =>
        item.id === candidate.id &&
        item.segment.source.startIndex === candidate.segment.source.startIndex &&
        item.segment.source.endIndex === candidate.segment.source.endIndex &&
        item.segment.source.text === candidate.segment.source.text,
    );
    if (!matched) continue;
    candidate.status = matched.status;
    candidate.selectedForExport = matched.selectedForExport;
    candidate.manuallyEdited = matched.manuallyEdited;
    candidate.mergedFrom = [...matched.mergedFrom];
    copyManualFields(matched.draft, candidate.draft);
  }
  return recount(next);
}

export function updateCandidateField<K extends EditableFieldName>(
  result: MultiEventExtractionResult,
  candidateId: string,
  name: K,
  value: EventDraft[K]["value"],
): MultiEventExtractionResult {
  return recount({
    ...result,
    candidates: result.candidates.map((candidate) => {
      if (candidate.id !== candidateId) return candidate;
      const field = candidate.draft[name] as ExtractedField<EventDraft[K]["value"]>;
      return {
        ...candidate,
        manuallyEdited: true,
        draft: {
          ...candidate.draft,
          [name]: { ...field, value, manuallyEdited: true },
        },
      };
    }),
  });
}

export function setCandidateStatus(
  result: MultiEventExtractionResult,
  candidateId: string,
  status: EventCandidateStatus,
): MultiEventExtractionResult {
  return recount({
    ...result,
    candidates: result.candidates.map((candidate) =>
      candidate.id === candidateId
        ? {
            ...candidate,
            status,
            selectedForExport:
              status === "ignored"
                ? false
                : status === "confirmed"
                  ? true
                  : candidate.selectedForExport,
          }
        : candidate,
    ),
  });
}

export function setCandidateSelected(
  result: MultiEventExtractionResult,
  candidateId: string,
  selectedForExport: boolean,
): MultiEventExtractionResult {
  return recount({
    ...result,
    candidates: result.candidates.map((candidate) =>
      candidate.id === candidateId && candidate.status !== "ignored"
        ? { ...candidate, selectedForExport }
        : candidate,
    ),
  });
}

export function selectCandidates(
  result: MultiEventExtractionResult,
  selection: "all" | "none" | "valid",
): MultiEventExtractionResult {
  return recount({
    ...result,
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      selectedForExport:
        candidate.status === "ignored"
          ? false
          : selection === "none"
            ? false
            : selection === "all"
              ? true
              : validateEvent(candidate.draft).length === 0,
    })),
  });
}

export function reparseCandidates(
  result: MultiEventExtractionResult,
  options: ParseEventTextOptions,
  preserveManualFields: boolean,
): MultiEventExtractionResult {
  const candidates = result.candidates.map((candidate) => {
    const reparsed = parseCandidateSegment(candidate.segment, result.originalText, options);
    reparsed.mergedFrom = [...candidate.mergedFrom];
    if (preserveManualFields) {
      copyManualFields(candidate.draft, reparsed.draft);
      reparsed.manuallyEdited = candidate.manuallyEdited;
      reparsed.status = candidate.status;
      reparsed.selectedForExport = candidate.selectedForExport;
    }
    return reparsed;
  });
  return recount({
    ...result,
    candidates,
    parseContext: {
      referenceDateTime: options.referenceDateTime.toISOString(),
      timeZone: options.timeZone,
    },
  });
}

function mergedIds(candidate: EventCandidate): string[] {
  return candidate.mergedFrom.length ? candidate.mergedFrom : [candidate.id];
}

export function mergeAdjacentCandidates(
  result: MultiEventExtractionResult,
  firstCandidateId: string,
  options: ParseEventTextOptions,
): CandidateMergeOperation | undefined {
  const index = result.candidates.findIndex((candidate) => candidate.id === firstCandidateId);
  if (index < 0 || index >= result.candidates.length - 1) return undefined;
  const first = result.candidates[index];
  const second = result.candidates[index + 1];
  const startIndex = first.segment.source.startIndex;
  const endIndex = second.segment.source.endIndex;
  const source = {
    text: result.originalText.slice(startIndex, endIndex),
    startIndex,
    endIndex,
  };
  const segment = {
    id: `segment-merge-${first.segment.id}-${second.segment.id}`,
    source,
    text: source.text,
    lineStart: first.segment.lineStart,
    lineEnd: second.segment.lineEnd,
    boundaryReason: "manual-merge" as const,
    inheritedContext: { ...first.segment.inheritedContext },
  };
  const merged = parseCandidateSegment(segment, result.originalText, options);
  merged.mergedFrom = [...mergedIds(first), ...mergedIds(second)];
  merged.status = "needs-review";
  merged.selectedForExport = validateEvent(merged.draft).length === 0;
  merged.warnings.push({
    code: "CANDIDATES_MERGED",
    message: "该候选由两个相邻候选手工合并并重新解析，请确认字段。",
    severity: "info",
  });
  const next = recount({
    ...result,
    candidates: [
      ...result.candidates.slice(0, index),
      merged,
      ...result.candidates.slice(index + 2),
    ],
  });
  return { result: next, previous: result, mergedCandidateId: merged.id };
}

export function undoCandidateMerge(operation: CandidateMergeOperation): MultiEventExtractionResult {
  return operation.previous;
}

export function appendUnassignedText(
  result: MultiEventExtractionResult,
  candidateId: string,
  fragmentIndex: number,
): MultiEventExtractionResult {
  const fragment = result.unassignedText[fragmentIndex];
  if (!fragment) return result;
  const candidate = result.candidates.find((item) => item.id === candidateId);
  if (!candidate) return result;
  const description = [candidate.draft.description.value, fragment.text].filter(Boolean).join("\n");
  const updated = updateCandidateField(result, candidateId, "description", description);
  const unassignedText = updated.unassignedText.filter((_, index) => index !== fragmentIndex);
  return {
    ...updated,
    unassignedText,
    warnings: unassignedText.length
      ? updated.warnings
      : updated.warnings.filter((warning) => warning.code !== "UNASSIGNED_TEXT"),
  };
}
