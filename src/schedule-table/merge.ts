import type { GridCell } from "./types";

export class GridCellMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridCellMergeError";
  }
}

export function mergeVerticalCourseCells(cells: GridCell[], selectedIds: string[]): GridCell[] {
  const selected = cells
    .filter((cell) => selectedIds.includes(cell.id))
    .sort((a, b) => a.rowIndex - b.rowIndex);
  if (selected.length < 2) throw new GridCellMergeError("请至少选择两个相邻课程单元格。");
  if (selected.some((cell) => cell.role === "ignored"))
    throw new GridCellMergeError("已忽略的单元格不能参与课程合并。");
  if (selected.some((cell) => cell.columnIndex !== selected[0].columnIndex))
    throw new GridCellMergeError("只能合并同一星期列中的单元格。");
  if (selected.some((cell) => cell.columnSpan !== 1))
    throw new GridCellMergeError("不能合并横跨星期列的单元格。");
  for (let index = 1; index < selected.length; index += 1) {
    const previousEnd = selected[index - 1].rowIndex + selected[index - 1].rowSpan;
    if (selected[index].rowIndex !== previousEnd)
      throw new GridCellMergeError("只能合并连续的时间行，不能跨过未选择的单元格。");
  }
  const first = selected[0];
  const last = selected[selected.length - 1];
  const selectedSet = new Set(selected.map((cell) => cell.id));
  const sourceCellIds = selected.flatMap((cell) => cell.sourceCellIds);
  const merged: GridCell = {
    ...first,
    id: `merged:${sourceCellIds.join("+")}`,
    rowSpan: last.rowIndex + last.rowSpan - first.rowIndex,
    bbox: {
      x: first.bbox.x,
      y: first.bbox.y,
      width: first.bbox.width,
      height: last.bbox.y + last.bbox.height - first.bbox.y,
    },
    role: "course",
    ocrBlockIds: selected.flatMap((cell) => cell.ocrBlockIds),
    originalText: selected
      .map((cell) => cell.originalText)
      .filter(Boolean)
      .join("\n"),
    text: selected
      .map((cell) => cell.text)
      .filter(Boolean)
      .join("\n"),
    confidence: selected.every((cell) => cell.confidence !== null)
      ? Math.min(...selected.map((cell) => cell.confidence as number))
      : null,
    manuallyMerged: true,
    sourceCellIds,
    warnings: selected.flatMap((cell) => cell.warnings),
  };
  return [...cells.filter((cell) => !selectedSet.has(cell.id)), merged].sort(
    (a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex,
  );
}
