import type {
  GridCell,
  ScheduleHeaderMapping,
  ScheduleWarning,
  ScheduleWeekday,
  WeekdayColumnMapping,
} from "./types";

const WEEKDAY_PATTERNS: Array<[RegExp, ScheduleWeekday]> = [
  [/^(?:(?:周|星期|礼拜)?\s*(?:一|1)|mon(?:day)?)$/i, "monday"],
  [/^(?:(?:周|星期|礼拜)?\s*(?:二|2)|tue(?:sday)?)$/i, "tuesday"],
  [/^(?:(?:周|星期|礼拜)?\s*(?:三|3)|wed(?:nesday)?)$/i, "wednesday"],
  [/^(?:(?:周|星期|礼拜)?\s*(?:四|4)|thu(?:rsday)?)$/i, "thursday"],
  [/^(?:(?:周|星期|礼拜)?\s*(?:五|5)|fri(?:day)?)$/i, "friday"],
  [/^(?:(?:周|星期|礼拜)?\s*(?:六|6)|sat(?:urday)?)$/i, "saturday"],
  [/^(?:(?:周|星期|礼拜)?\s*(?:日|天|七|7)|sun(?:day)?)$/i, "sunday"],
];

export function parseScheduleWeekday(text: string): ScheduleWeekday | null {
  const normalized = text.trim().replace(/\s+/g, "");
  for (const [pattern, weekday] of WEEKDAY_PATTERNS) if (pattern.test(normalized)) return weekday;
  return null;
}

function looksLikeTimeHeader(text: string): boolean {
  return (
    /\d{1,2}\s*[:：]\s*\d{2}/.test(text) ||
    /(?:第\s*)?[一二三四五六七八九十\d]+(?:\s*[-—–至]\s*[一二三四五六七八九十\d]+)?\s*节/.test(text)
  );
}

export interface HeaderDetectionResult {
  mapping: ScheduleHeaderMapping;
  cells: GridCell[];
  warnings: ScheduleWarning[];
}

export function validateWeekdayMappings(
  mappings: WeekdayColumnMapping[],
  columnCount: number,
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const counts = new Map<ScheduleWeekday, number>();
  for (const mapping of mappings) {
    counts.set(mapping.weekday, (counts.get(mapping.weekday) ?? 0) + 1);
    if (mapping.columnIndex < 0 || mapping.columnIndex >= columnCount)
      warnings.push({
        code: "WEEKDAY_HEADER_NOT_FOUND",
        message: "星期映射指向了网格范围外的列。",
        severity: "error",
        scope: "grid",
        targetId: mapping.sourceCellId,
      });
  }
  if (!mappings.length)
    warnings.push({
      code: "WEEKDAY_HEADER_NOT_FOUND",
      message: "没有找到星期列，请手工指定星期标题行和列映射。",
      severity: "error",
      scope: "grid",
    });
  if ([...counts.values()].some((count) => count > 1))
    warnings.push({
      code: "DUPLICATE_WEEKDAY_MAPPING",
      message: "同一个星期被映射到了多列，请为每个星期只保留一列。",
      severity: "error",
      scope: "grid",
    });
  return warnings;
}

export function detectScheduleHeaders(cells: GridCell[]): HeaderDetectionResult {
  const rows = new Map<number, Array<{ cell: GridCell; weekday: ScheduleWeekday }>>();
  for (const cell of cells) {
    const weekday = parseScheduleWeekday(cell.text);
    if (!weekday) continue;
    const row = rows.get(cell.rowIndex) ?? [];
    row.push({ cell, weekday });
    rows.set(cell.rowIndex, row);
  }
  const bestRow = [...rows.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
  const weekdayHeaderRowIndex = bestRow?.[0] ?? null;
  const weekdayMappings: WeekdayColumnMapping[] = (bestRow?.[1] ?? []).map(({ cell, weekday }) => ({
    columnIndex: cell.columnIndex,
    weekday,
    sourceCellId: cell.id,
    manuallyConfirmed: false,
  }));
  const candidateColumns = new Map<number, number>();
  for (const cell of cells) {
    if (cell.rowIndex === weekdayHeaderRowIndex || !looksLikeTimeHeader(cell.text)) continue;
    candidateColumns.set(cell.columnIndex, (candidateColumns.get(cell.columnIndex) ?? 0) + 1);
  }
  const timeHeaderColumnIndex =
    [...candidateColumns.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const columnCount = Math.max(0, ...cells.map((cell) => cell.columnIndex + 1));
  const warnings = validateWeekdayMappings(weekdayMappings, columnCount);
  if (timeHeaderColumnIndex === null)
    warnings.push({
      code: "TIME_HEADER_NOT_FOUND",
      message: "没有找到时间或节次标题列，请手工指定。",
      severity: "error",
      scope: "grid",
    });
  const weekdayIds = new Set(weekdayMappings.map((mapping) => mapping.sourceCellId));
  const mappedCells = cells.map((cell) => {
    if (weekdayIds.has(cell.id)) return { ...cell, role: "weekday-header" as const };
    if (cell.columnIndex === timeHeaderColumnIndex && cell.rowIndex !== weekdayHeaderRowIndex)
      return { ...cell, role: "time-header" as const };
    if (cell.rowIndex === weekdayHeaderRowIndex && cell.columnIndex === timeHeaderColumnIndex)
      return { ...cell, role: "corner" as const };
    if (
      weekdayMappings.some((mapping) => mapping.columnIndex === cell.columnIndex) &&
      cell.rowIndex !== weekdayHeaderRowIndex
    )
      return { ...cell, role: cell.text.trim() ? ("course" as const) : ("unknown" as const) };
    return cell;
  });
  return {
    mapping: {
      weekdayHeaderRowIndex,
      timeHeaderColumnIndex,
      weekdayMappings,
      manuallyConfirmed: false,
    },
    cells: mappedCells,
    warnings,
  };
}

export function applyHeaderMappingRoles(
  cells: GridCell[],
  mapping: ScheduleHeaderMapping,
): GridCell[] {
  const weekdayColumns = new Set(mapping.weekdayMappings.map((item) => item.columnIndex));
  return cells.map((cell) => {
    if (
      cell.rowIndex === mapping.weekdayHeaderRowIndex &&
      cell.columnIndex === mapping.timeHeaderColumnIndex
    )
      return { ...cell, role: "corner" };
    if (cell.rowIndex === mapping.weekdayHeaderRowIndex && weekdayColumns.has(cell.columnIndex))
      return { ...cell, role: "weekday-header" };
    if (
      cell.columnIndex === mapping.timeHeaderColumnIndex &&
      cell.rowIndex !== mapping.weekdayHeaderRowIndex
    )
      return { ...cell, role: "time-header" };
    if (
      weekdayColumns.has(cell.columnIndex) &&
      cell.rowIndex !== mapping.weekdayHeaderRowIndex &&
      cell.role !== "ignored"
    )
      return { ...cell, role: cell.text.trim() ? "course" : "unknown" };
    return cell.role === "course" ? { ...cell, role: "unknown" } : cell;
  });
}
