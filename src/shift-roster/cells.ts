import type { GridCell } from "../schedule-table";
import type { RosterCell, RosterHeaderMapping, RosterWarning } from "./types";

function mappedRole(cell: RosterCell, mapping: RosterHeaderMapping): RosterCell["role"] {
  if (
    cell.rowIndex === mapping.dateHeaderRowIndex &&
    cell.columnIndex === mapping.personColumnIndex
  )
    return "corner";
  if (cell.rowIndex === mapping.dateHeaderRowIndex) return "date-header";
  if (cell.rowIndex === mapping.weekdayHeaderRowIndex) return "weekday-header";
  if (cell.columnIndex === mapping.personColumnIndex) return "person-header";
  const inPeople =
    mapping.firstPersonRowIndex !== null &&
    mapping.lastPersonRowIndex !== null &&
    cell.rowIndex >= mapping.firstPersonRowIndex &&
    cell.rowIndex <= mapping.lastPersonRowIndex;
  const inDates =
    mapping.firstDateColumnIndex !== null &&
    mapping.lastDateColumnIndex !== null &&
    cell.columnIndex >= mapping.firstDateColumnIndex &&
    cell.columnIndex <= mapping.lastDateColumnIndex;
  return inPeople && inDates ? "assignment" : "ignored";
}

export function createRosterCells(cells: GridCell[]): RosterCell[] {
  return cells.map((cell) => ({
    gridCellId: cell.id,
    rowIndex: cell.rowIndex,
    columnIndex: cell.columnIndex,
    bbox: cell.bbox,
    ocrBlockIds: cell.ocrBlockIds,
    confidence: cell.confidence,
    role: "unknown",
    originalText: cell.originalText,
    text: cell.text,
    manuallyEdited: false,
    warnings: [],
  }));
}

export function applyRosterHeaderMapping(
  cells: RosterCell[],
  mapping: RosterHeaderMapping,
): RosterCell[] {
  return cells.map((cell) =>
    cell.role === "ignored" && cell.manuallyEdited
      ? cell
      : { ...cell, role: mappedRole(cell, mapping) },
  );
}

function looksLikeRosterDate(value: string): boolean {
  const text = value.trim().replace(/\s+/g, "");
  return (
    /^\d{4}(?:[-/.]|年)\d{1,2}(?:[-/.]|月)\d{1,2}日?$/.test(text) ||
    /^\d{1,2}(?:[-/.]|月)\d{1,2}日?$/.test(text) ||
    /^\d{1,2}日?$/.test(text)
  );
}

export interface RosterMappingDetectionResult {
  mapping: RosterHeaderMapping;
  cells: RosterCell[];
  warnings: RosterWarning[];
}

export function detectRosterHeaderMapping(cells: RosterCell[]): RosterMappingDetectionResult {
  const rowCounts = new Map<number, number>();
  for (const cell of cells) {
    if (!looksLikeRosterDate(cell.text)) continue;
    rowCounts.set(cell.rowIndex, (rowCounts.get(cell.rowIndex) ?? 0) + 1);
  }
  const dateHeaderRowIndex =
    [...rowCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const dateCells = cells
    .filter((cell) => cell.rowIndex === dateHeaderRowIndex && looksLikeRosterDate(cell.text))
    .sort((a, b) => a.columnIndex - b.columnIndex);
  const rowCount = Math.max(0, ...cells.map((cell) => cell.rowIndex + 1));
  const personColumnIndex = dateCells.length ? Math.max(0, dateCells[0].columnIndex - 1) : null;
  const mapping: RosterHeaderMapping = {
    dateHeaderRowIndex,
    weekdayHeaderRowIndex: null,
    personColumnIndex,
    firstPersonRowIndex: dateHeaderRowIndex === null ? null : dateHeaderRowIndex + 1,
    lastPersonRowIndex: dateHeaderRowIndex === null ? null : rowCount - 1,
    firstDateColumnIndex: dateCells[0]?.columnIndex ?? null,
    lastDateColumnIndex: dateCells.at(-1)?.columnIndex ?? null,
    manuallyConfirmed: false,
  };
  const warnings: RosterWarning[] = [];
  if (dateHeaderRowIndex === null)
    warnings.push({
      code: "ROSTER_DATE_HEADER_NOT_FOUND",
      message: "没有可靠识别到日期标题行，请手工指定。",
      severity: "error",
      scope: "grid",
    });
  if (personColumnIndex === null)
    warnings.push({
      code: "ROSTER_PERSON_COLUMN_NOT_FOUND",
      message: "没有可靠识别到人员姓名列，请手工指定。",
      severity: "error",
      scope: "grid",
    });
  return { mapping, cells: applyRosterHeaderMapping(cells, mapping), warnings };
}
