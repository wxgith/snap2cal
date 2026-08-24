import type { ExtractionWarning, SourceSpan } from "../domain/event";
import {
  TIMETABLE_WEEKDAY_LABELS,
  type TimetableCourseCell,
  type TimetableExtractionResult,
  type TimetablePeriod,
  type TimetableWeekRange,
  type TimetableWeekday,
} from "../domain/timetable";
import type { ParseEventTextOptions } from "../parser";

interface TextCell {
  text: string;
  startIndex: number;
  endIndex: number;
}

interface HeaderColumn {
  cellIndex: number;
  weekday: TimetableWeekday;
  source: SourceSpan;
}

const WEEKDAY_PATTERNS: Array<[RegExp, TimetableWeekday]> = [
  [/^(?:周|星期|礼拜)一$/, 1],
  [/^(?:周|星期|礼拜)二$/, 2],
  [/^(?:周|星期|礼拜)三$/, 3],
  [/^(?:周|星期|礼拜)四$/, 4],
  [/^(?:周|星期|礼拜)五$/, 5],
  [/^(?:周|星期|礼拜)六$/, 6],
  [/^(?:周|星期|礼拜)(?:日|天)$/, 7],
];

const TIME_RANGE_PATTERN = /(\d{1,2}):([0-5]\d)\s*(?:-|~|至|到)\s*(\d{1,2}):([0-5]\d)/;
const PERIOD_PATTERN = /(?:第)?\s*(\d{1,2})(?:\s*(?:-|~|至|到)\s*(\d{1,2}))?\s*节?/;
const WEEK_PATTERN =
  /(?:第)?\s*(\d{1,2})(?:\s*(?:-|~|至|到)\s*(\d{1,2}))?\s*周|单周|双周|每周|全周/g;

function makeSourceFromCell(cell: TextCell): SourceSpan {
  return { text: cell.text, startIndex: cell.startIndex, endIndex: cell.endIndex };
}

function trimCell(raw: string, startIndex: number): TextCell {
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  const text = raw.slice(leading, raw.length - trailing);
  return {
    text,
    startIndex: startIndex + leading,
    endIndex: startIndex + raw.length - trailing,
  };
}

export function splitTableLine(line: string, lineStartIndex: number): TextCell[] {
  if (!line.includes("|")) return [trimCell(line, lineStartIndex)];
  const cells: TextCell[] = [];
  let partStart = 0;
  for (let index = 0; index <= line.length; index += 1) {
    if (index === line.length || line[index] === "|") {
      cells.push(trimCell(line.slice(partStart, index), lineStartIndex + partStart));
      partStart = index + 1;
    }
  }
  return cells;
}

export function parseWeekdayLabel(text: string): TimetableWeekday | null {
  const normalized = text.trim().replace(/\s+/g, "");
  for (const [pattern, weekday] of WEEKDAY_PATTERNS) if (pattern.test(normalized)) return weekday;
  return null;
}

function normalizeHour(hour: string): string {
  return hour.padStart(2, "0");
}

export function parseTimetablePeriod(cell: TextCell): TimetablePeriod | null {
  const periodMatch = PERIOD_PATTERN.exec(cell.text);
  if (!periodMatch) return null;
  const startPeriod = Number(periodMatch[1]);
  const endPeriod = Number(periodMatch[2] ?? periodMatch[1]);
  const timeMatch = TIME_RANGE_PATTERN.exec(cell.text);
  return {
    label: `${startPeriod}${endPeriod === startPeriod ? "" : `-${endPeriod}`}节`,
    startPeriod,
    endPeriod,
    startTime: timeMatch ? `${normalizeHour(timeMatch[1])}:${timeMatch[2]}` : null,
    endTime: timeMatch ? `${normalizeHour(timeMatch[3])}:${timeMatch[4]}` : null,
    source: makeSourceFromCell(cell),
    confidence: timeMatch ? "high" : "medium",
  };
}

function parseHeader(cells: TextCell[]): HeaderColumn[] {
  return cells
    .map((cell, cellIndex) => ({ cell, cellIndex, weekday: parseWeekdayLabel(cell.text) }))
    .filter(
      (item): item is { cell: TextCell; cellIndex: number; weekday: TimetableWeekday } =>
        item.weekday !== null,
    )
    .map((item) => ({
      cellIndex: item.cellIndex,
      weekday: item.weekday,
      source: makeSourceFromCell(item.cell),
    }));
}

function sourceForSlice(parent: TextCell, start: number, end: number): SourceSpan {
  const text = parent.text.slice(start, end);
  return {
    text,
    startIndex: parent.startIndex + start,
    endIndex: parent.startIndex + end,
  };
}

function removeRanges(text: string, ranges: Array<[number, number]>): string {
  let result = "";
  let cursor = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    result += text.slice(cursor, start);
    cursor = end;
  }
  return `${result}${text.slice(cursor)}`;
}

export function parseWeekRanges(cell: TextCell): {
  ranges: TimetableWeekRange[];
  removedRanges: Array<[number, number]>;
} {
  const ranges: TimetableWeekRange[] = [];
  const removedRanges: Array<[number, number]> = [];
  for (const match of cell.text.matchAll(WEEK_PATTERN)) {
    const source = sourceForSlice(cell, match.index, match.index + match[0].length);
    if (match[0].includes("单周") || match[0].includes("双周")) {
      ranges.push({
        startWeek: 1,
        endWeek: null,
        parity: match[0].includes("单周") ? "odd" : "even",
        source,
        derivedFromDefault: false,
      });
    } else if (match[0].includes("每周") || match[0].includes("全周")) {
      ranges.push({
        startWeek: 1,
        endWeek: null,
        parity: "all",
        source,
        derivedFromDefault: false,
      });
    } else {
      const startWeek = Number(match[1]);
      ranges.push({
        startWeek,
        endWeek: match[2] ? Number(match[2]) : startWeek,
        parity: "all",
        source,
        derivedFromDefault: false,
      });
    }
    removedRanges.push([match.index, match.index + match[0].length]);
  }
  return { ranges, removedRanges };
}

function splitCourseEntries(cell: TextCell): TextCell[] {
  const entries: TextCell[] = [];
  let start = 0;
  for (let index = 0; index <= cell.text.length; index += 1) {
    const character = cell.text[index];
    if (index === cell.text.length || character === "；" || character === ";") {
      const entry = trimCell(cell.text.slice(start, index), cell.startIndex + start);
      if (entry.text) entries.push(entry);
      start = index + 1;
    }
  }
  return entries;
}

function parseCourseCell(
  entry: TextCell,
  weekday: TimetableWeekday,
  period: TimetablePeriod,
  index: number,
  evidenceBlockIds: string[] = [],
): TimetableCourseCell {
  const weekResult = parseWeekRanges(entry);
  let cleaned = removeRanges(entry.text, weekResult.removedRanges).replace(/[［[\]］（）()]/g, " ");
  let location = "";
  let locationSource: SourceSpan | undefined;
  const atIndex = cleaned.indexOf("@");
  const locationMatch = /(?:地点|教室|地址)\s*[:：]\s*(.+)$/.exec(cleaned);
  if (atIndex >= 0) {
    const rawLocation = cleaned.slice(atIndex + 1);
    const offset = rawLocation.match(/^\s*/)?.[0].length ?? 0;
    location = rawLocation.trim();
    locationSource = sourceForSlice(entry, atIndex + 1 + offset, entry.text.length);
    cleaned = cleaned.slice(0, atIndex);
  } else if (locationMatch?.index !== undefined) {
    const valueStart = locationMatch.index + locationMatch[0].indexOf(locationMatch[1]);
    location = locationMatch[1].trim();
    locationSource = sourceForSlice(entry, valueStart, valueStart + locationMatch[1].length);
    cleaned = cleaned.slice(0, locationMatch.index);
  }
  const title = cleaned
    .replace(/\s+/g, " ")
    .replace(/[，,。]+$/g, "")
    .trim();
  const warnings: ExtractionWarning[] = [];
  if (!title)
    warnings.push({
      code: "TIMETABLE_MISSING_TITLE",
      message: `课程表单元格缺少课程名称：${TIMETABLE_WEEKDAY_LABELS[weekday]} ${period.label}。`,
      severity: "error",
    });
  if (!period.startTime || !period.endTime)
    warnings.push({
      code: "TIMETABLE_MISSING_PERIOD_TIME",
      message: `第 ${period.label} 没有明确起止时间，不能直接导出日历。`,
      severity: "error",
    });
  if (!location)
    warnings.push({
      code: "TIMETABLE_MISSING_LOCATION",
      message: `${title || "该课程"} 没有识别到地点，导出时会保持地点为空。`,
      severity: "info",
    });
  if (weekResult.ranges.length === 0)
    warnings.push({
      code: "TIMETABLE_WEEKS_DEFAULTED",
      message: `${title || "该课程"} 没有识别到周次，导出时需要按学期周数推断。`,
      severity: "warning",
    });
  const confidence = warnings.some((warning) => warning.severity === "error")
    ? "low"
    : warnings.length
      ? "medium"
      : "high";
  return {
    id: `course-${weekday}-${period.startPeriod}-${period.endPeriod}-${entry.startIndex}-${index}`,
    title,
    location,
    weekday,
    period,
    weekRanges: weekResult.ranges,
    source: makeSourceFromCell(entry),
    titleSource: makeSourceFromCell(entry),
    locationSource,
    confidence,
    warnings,
    selectedForExport: !warnings.some((warning) => warning.severity === "error"),
    evidenceBlockIds,
    manuallyEdited: false,
  };
}

function collectLines(input: string): Array<{ text: string; startIndex: number }> {
  const lines: Array<{ text: string; startIndex: number }> = [];
  let startIndex = 0;
  for (const match of input.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    const raw = match[0];
    if (raw === "") continue;
    const text = raw.replace(/\r?\n|\r$/, "");
    lines.push({ text, startIndex });
    startIndex += raw.length;
  }
  return lines;
}

export function parseTimetableText(
  input: string,
  options: ParseEventTextOptions,
): TimetableExtractionResult {
  const warnings: ExtractionWarning[] = [];
  const lines = collectLines(input);
  const parsedLines = lines.map((line) => ({
    ...line,
    cells: splitTableLine(line.text, line.startIndex),
  }));
  const headerLine = parsedLines.find((line) => parseHeader(line.cells).length >= 2);
  if (!input.trim())
    warnings.push({
      code: "TIMETABLE_EMPTY_INPUT",
      message: "请先粘贴课程表文本，或从已识别图片生成课程表。",
      severity: "error",
    });
  if (!headerLine)
    warnings.push({
      code: "TIMETABLE_HEADER_NOT_FOUND",
      message: "未识别到包含至少两个星期列的课程表表头。",
      severity: "error",
    });

  const columns = headerLine ? parseHeader(headerLine.cells) : [];
  const cells: TimetableCourseCell[] = [];
  const headerIndex = headerLine ? parsedLines.indexOf(headerLine) : -1;
  for (const line of parsedLines.slice(headerIndex + 1)) {
    if (!line.text.trim()) continue;
    const period = parseTimetablePeriod(line.cells[0]);
    if (!period) {
      if (line.cells.some((cell) => cell.text.trim()))
        warnings.push({
          code: "TIMETABLE_ROW_PERIOD_NOT_FOUND",
          message: `未识别到课程表行的节次：${line.text.trim()}。`,
          severity: "warning",
        });
      continue;
    }
    for (const column of columns) {
      const courseCell = line.cells[column.cellIndex];
      if (!courseCell?.text.trim()) continue;
      for (const entry of splitCourseEntries(courseCell))
        cells.push(parseCourseCell(entry, column.weekday, period, cells.length));
    }
  }

  if (headerLine && cells.length === 0)
    warnings.push({
      code: "TIMETABLE_NO_COURSES",
      message: "已识别表头和节次，但没有找到可导出的课程单元格。",
      severity: "warning",
    });

  return {
    id: `timetable-${options.referenceDateTime.toISOString()}`,
    sourceKind: "text-table",
    originalText: input,
    cells,
    warnings,
    parseContext: {
      referenceDateTime: options.referenceDateTime.toISOString(),
      timeZone: options.timeZone,
    },
    detectedCount: cells.length,
    selectedCount: cells.filter((cell) => cell.selectedForExport).length,
  };
}

export function createTimetableCellFromOcrText(
  text: TextCell,
  weekday: TimetableWeekday,
  period: TimetablePeriod,
  index: number,
  evidenceBlockIds: string[],
): TimetableCourseCell {
  return parseCourseCell(text, weekday, period, index, evidenceBlockIds);
}
