import { makeSource, type ExtractionWarning, type SourceSpan } from "../domain/event";
import type {
  CandidateBoundaryReason,
  CandidateInheritedContext,
  CandidateSegment,
  InheritedContextValue,
  UnassignedTextFragment,
} from "../domain/multiEvent";
import {
  BOUNDARY_DATE,
  BULLET_PREFIX,
  EXPLICIT_EVENT_PREFIX,
  LOCATION_HEADING,
  NUMBERED_PREFIX,
  hasDateExpression,
  hasTimeExpression,
  looksLikeCompleteEvent,
} from "./patterns";

const MAX_CANDIDATES = 50;
const SECTION_HEADING =
  /^\s*(?:第[一二三四五六七八九十\d]+(?:部分|节)|(?:上午|下午|晚间|其他)(?:安排|事项)|其他事项)\s*[：:]?\s*$/;

interface SourceLine {
  number: number;
  start: number;
  contentEnd: number;
  fullEnd: number;
  text: string;
}

interface PendingLine {
  line: SourceLine;
  contentStart: number;
  contentEnd: number;
  reason?: CandidateBoundaryReason;
}

export interface SegmentEventTextResult {
  segments: CandidateSegment[];
  unassignedText: UnassignedTextFragment[];
  warnings: ExtractionWarning[];
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableSegmentId(source: SourceSpan, order: number): string {
  return `segment-${source.startIndex}-${source.endIndex}-${order}-${hashText(source.text)}`;
}

function splitLines(input: string): SourceLine[] {
  if (!input.length) return [];
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;
  while (start < input.length) {
    let contentEnd = start;
    while (contentEnd < input.length && input[contentEnd] !== "\r" && input[contentEnd] !== "\n")
      contentEnd += 1;
    let fullEnd = contentEnd;
    if (input[fullEnd] === "\r" && input[fullEnd + 1] === "\n") fullEnd += 2;
    else if (input[fullEnd] === "\r" || input[fullEnd] === "\n") fullEnd += 1;
    lines.push({
      number,
      start,
      contentEnd,
      fullEnd,
      text: input.slice(start, contentEnd),
    });
    start = fullEnd;
    number += 1;
  }
  return lines;
}

function trimmedBounds(input: string, start: number, end: number): [number, number] | undefined {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/.test(input[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/.test(input[trimmedEnd - 1])) trimmedEnd -= 1;
  return trimmedStart < trimmedEnd ? [trimmedStart, trimmedEnd] : undefined;
}

function markerFor(line: SourceLine): PendingLine | undefined {
  for (const [pattern, reason] of [
    [BULLET_PREFIX, "bullet"],
    [NUMBERED_PREFIX, "numbered-item"],
    [EXPLICIT_EVENT_PREFIX, "explicit-label"],
  ] as const) {
    const match = pattern.exec(line.text);
    if (!match) continue;
    const bounds = trimmedBounds(line.text, match[0].length, line.text.length);
    if (!bounds) return undefined;
    return {
      line,
      contentStart: line.start + bounds[0],
      contentEnd: line.start + bounds[1],
      reason,
    };
  }
  const bounds = trimmedBounds(line.text, 0, line.text.length);
  return bounds
    ? {
        line,
        contentStart: line.start + bounds[0],
        contentEnd: line.start + bounds[1],
      }
    : undefined;
}

function dateContextFromLine(input: string, line: SourceLine): InheritedContextValue | undefined {
  const match = BOUNDARY_DATE.exec(line.text);
  if (!match) return undefined;
  const remaining = line.text
    .slice(0, match.index)
    .concat(line.text.slice(match.index + match[0].length))
    .replace(/(?:日期|活动日期|会议日期|时间)\s*[：:]?/g, "")
    .replace(LOCATION_HEADING, "")
    .replace(/[\s，,；;。:：\-–—]/g, "");
  if (remaining) return undefined;
  const start = line.start + match.index;
  return { value: match[0], source: makeSource(input, start, match[0]) };
}

function locationContextFromLine(
  input: string,
  line: SourceLine,
): InheritedContextValue | undefined {
  const match = LOCATION_HEADING.exec(line.text);
  if (!match || hasDateExpression(match[1]) || hasTimeExpression(match[1])) return undefined;
  const value = match[1].trim();
  const relative = line.text.indexOf(value, match.index);
  return { value, source: makeSource(input, line.start + relative, value) };
}

function inlineLocationContextFromLine(
  input: string,
  line: SourceLine,
): InheritedContextValue | undefined {
  const match = /(?:地点|地址)\s*[：:]\s*([^，,；;。\n]+)/.exec(line.text);
  if (!match) return undefined;
  const value = match[1].trim();
  const relative = line.text.indexOf(value, match.index);
  return { value, source: makeSource(input, line.start + relative, value) };
}

function followingEventLineCount(
  lines: SourceLine[],
  startIndex: number,
  inheritedDate: boolean,
): number {
  let count = 0;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const text = lines[index].text.trim();
    if (!text) continue;
    if (hasDateExpression(text) && !hasTimeExpression(text)) break;
    const marker = markerFor(lines[index]);
    const value = marker ? lines[index].text.slice(marker.contentStart - lines[index].start) : text;
    if (
      looksLikeCompleteEvent(value, inheritedDate) ||
      (inheritedDate && hasTimeExpression(value))
    ) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function splitSemicolon(
  input: string,
  pending: PendingLine,
  inheritedDate: boolean,
): PendingLine[] | undefined {
  const value = input.slice(pending.contentStart, pending.contentEnd);
  const separators = [...value.matchAll(/[；;]/g)];
  if (!separators.length) return undefined;
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (const separator of separators) {
    const bounds = trimmedBounds(value, start, separator.index);
    if (!bounds) return undefined;
    ranges.push(bounds);
    start = separator.index + separator[0].length;
  }
  const finalBounds = trimmedBounds(value, start, value.length);
  if (!finalBounds) return undefined;
  ranges.push(finalBounds);
  if (
    ranges.some(
      ([rangeStart, rangeEnd]) =>
        !looksLikeCompleteEvent(value.slice(rangeStart, rangeEnd), inheritedDate),
    )
  )
    return undefined;
  return ranges.map(([rangeStart, rangeEnd]) => ({
    ...pending,
    contentStart: pending.contentStart + rangeStart,
    contentEnd: pending.contentStart + rangeEnd,
    reason: "semicolon",
  }));
}

export function segmentEventText(input: string): SegmentEventTextResult {
  const lines = splitLines(input);
  const segments: CandidateSegment[] = [];
  const unassignedText: UnassignedTextFragment[] = [];
  const warnings: ExtractionWarning[] = [];
  let inheritedContext: CandidateInheritedContext = {};
  let pending: PendingLine[] = [];
  let limitReached = false;

  const addUnassigned = (line: SourceLine, reason: UnassignedTextFragment["reason"]) => {
    const bounds = trimmedBounds(input, line.start, line.contentEnd);
    if (!bounds) return;
    const [start, end] = bounds;
    unassignedText.push({
      source: makeSource(input, start, input.slice(start, end)),
      text: input.slice(start, end),
      reason,
    });
  };

  const emit = (items: PendingLine[], forcedReason?: CandidateBoundaryReason) => {
    if (!items.length) return;
    const start = items[0].contentStart;
    const end = items[items.length - 1].contentEnd;
    const source = makeSource(input, start, input.slice(start, end));
    if (segments.length >= MAX_CANDIDATES) {
      limitReached = true;
      unassignedText.push({ source, text: source.text, reason: "ambiguous" });
      return;
    }
    const reason =
      forcedReason ??
      items[0].reason ??
      (items.length > 1 ? "blank-line" : segments.length ? "date-prefix" : "single-event-fallback");
    segments.push({
      id: stableSegmentId(source, segments.length),
      source,
      text: source.text,
      lineStart: items[0].line.number,
      lineEnd: items[items.length - 1].line.number,
      boundaryReason: reason,
      inheritedContext: { ...inheritedContext },
    });
  };

  const flush = (reason?: CandidateBoundaryReason) => {
    if (pending.length) {
      const pendingText = input.slice(
        pending[0].contentStart,
        pending[pending.length - 1].contentEnd,
      );
      if (
        hasDateExpression(pendingText) ||
        hasTimeExpression(pendingText) ||
        /全天|整天/.test(pendingText)
      )
        emit(pending, reason);
      else for (const item of pending) addUnassigned(item.line, "unrecognized");
    }
    pending = [];
  };

  const retainPendingAsUnassigned = () => {
    for (const item of pending) addUnassigned(item.line, "ambiguous");
    pending = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marked = markerFor(line);
    if (!marked) {
      if (pending.length) flush("blank-line");
      continue;
    }

    if (SECTION_HEADING.test(line.text)) {
      flush();
      inheritedContext = {};
      addUnassigned(line, "context-heading");
      continue;
    }

    const simpleDateContext = dateContextFromLine(input, line);
    const combinedDateMatch = BOUNDARY_DATE.exec(line.text);
    const combinedLocationContext = inlineLocationContextFromLine(input, line);
    const combinedDateContext =
      combinedDateMatch && combinedLocationContext && !hasTimeExpression(line.text)
        ? {
            value: combinedDateMatch[0],
            source: makeSource(input, line.start + combinedDateMatch.index, combinedDateMatch[0]),
          }
        : undefined;
    const dateContext = simpleDateContext ?? combinedDateContext;
    const locationContext = locationContextFromLine(input, line) ?? combinedLocationContext;
    const sharedDate = dateContext && followingEventLineCount(lines, index, true) >= 2;
    const sharedLocation =
      locationContext &&
      followingEventLineCount(lines, index, Boolean(inheritedContext.date || dateContext)) >= 2;
    if (sharedDate || sharedLocation) {
      flush();
      if (sharedDate) inheritedContext = { ...inheritedContext, date: dateContext };
      if (sharedLocation) inheritedContext = { ...inheritedContext, location: locationContext };
      addUnassigned(line, "context-heading");
      continue;
    }

    const value = input.slice(marked.contentStart, marked.contentEnd);
    const semicolonParts = splitSemicolon(input, marked, Boolean(inheritedContext.date));
    if (semicolonParts) {
      flush();
      for (const part of semicolonParts) emit([part], "semicolon");
      continue;
    }
    if (marked.reason) {
      if (pending.length) {
        const pendingText = input.slice(
          pending[0].contentStart,
          pending[pending.length - 1].contentEnd,
        );
        if (looksLikeCompleteEvent(pendingText, Boolean(inheritedContext.date))) flush();
        else retainPendingAsUnassigned();
      }
      emit([marked]);
      continue;
    }
    if (inheritedContext.date && hasDateExpression(value) && looksLikeCompleteEvent(value)) {
      flush();
      inheritedContext = inheritedContext.location ? { location: inheritedContext.location } : {};
      emit([marked], "date-prefix");
      continue;
    }
    if (inheritedContext.date && hasTimeExpression(value)) {
      flush();
      emit([marked], "shared-context");
      continue;
    }
    if (looksLikeCompleteEvent(value)) {
      flush();
      emit([marked], "date-prefix");
      continue;
    }
    if (
      segments.length &&
      !pending.length &&
      !hasDateExpression(value) &&
      !hasTimeExpression(value)
    ) {
      addUnassigned(line, "trailing-note");
      continue;
    }
    pending.push(marked);
  }
  flush();

  if (
    segments.length === 1 &&
    segments[0].boundaryReason === "date-prefix" &&
    !segments[0].inheritedContext.date &&
    !segments[0].inheritedContext.location
  ) {
    segments[0] = { ...segments[0], boundaryReason: "single-event-fallback" };
  }

  if (limitReached) {
    warnings.push({
      code: "CANDIDATE_LIMIT_REACHED",
      message: `最多处理 ${MAX_CANDIDATES} 个事件候选，其余文字已保留但未解析。`,
      severity: "warning",
    });
  }
  if (unassignedText.length) {
    warnings.push({
      code: "UNASSIGNED_TEXT",
      message: `有 ${unassignedText.length} 段文字未直接分配给事件，请人工检查。`,
      severity: "warning",
    });
  }
  return { segments, unassignedText, warnings };
}
