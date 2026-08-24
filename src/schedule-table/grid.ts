import type { OcrBlock, OcrDocument } from "../ocr/types";
import type { GridCell, GridLine, ScheduleWarning, TableGrid } from "./types";

export const MIN_GRID_CELL_SIZE = 4;

function warning(
  code: ScheduleWarning["code"],
  message: string,
  severity: ScheduleWarning["severity"] = "error",
): ScheduleWarning {
  return { code, message, severity, scope: "grid" };
}

export function sortGridLines(lines: GridLine[]): GridLine[] {
  return [...lines].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function validateGrid(grid: TableGrid): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const horizontal = sortGridLines(grid.horizontalLines);
  const vertical = sortGridLines(grid.verticalLines);
  if (horizontal.length < 2)
    warnings.push(warning("GRID_TOO_FEW_ROWS", "至少需要两条水平网格线。"));
  if (vertical.length < 2)
    warnings.push(warning("GRID_TOO_FEW_COLUMNS", "至少需要两条垂直网格线。"));
  for (const [lines, limit, label] of [
    [horizontal, grid.imageHeight, "水平"],
    [vertical, grid.imageWidth, "垂直"],
  ] as const) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.position < 0 || line.position > limit)
        warnings.push(warning("GRID_CELL_TOO_SMALL", `${label}网格线超出图片范围。`));
      if (index === 0) continue;
      const gap = line.position - lines[index - 1].position;
      if (gap === 0) {
        warnings.push(warning("GRID_DUPLICATE_LINE", `${label}方向存在位置相同的重复网格线。`));
        warnings.push(warning("GRID_CELL_TOO_SMALL", `${label}方向形成了零尺寸单元格。`));
      } else if (gap < MIN_GRID_CELL_SIZE)
        warnings.push(
          warning("GRID_CELL_TOO_SMALL", `${label}方向的相邻网格线距离小于最小单元格尺寸。`),
        );
    }
  }
  return warnings;
}

export function withValidatedGrid(grid: TableGrid): TableGrid {
  const normalized = {
    ...grid,
    horizontalLines: sortGridLines(grid.horizontalLines),
    verticalLines: sortGridLines(grid.verticalLines),
  };
  return { ...normalized, warnings: [...grid.warnings, ...validateGrid(normalized)] };
}

export function buildGridCells(grid: TableGrid): GridCell[] {
  const horizontal = sortGridLines(grid.horizontalLines);
  const vertical = sortGridLines(grid.verticalLines);
  const cells: GridCell[] = [];
  for (let rowIndex = 0; rowIndex < horizontal.length - 1; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < vertical.length - 1; columnIndex += 1) {
      const top = horizontal[rowIndex];
      const bottom = horizontal[rowIndex + 1];
      const left = vertical[columnIndex];
      const right = vertical[columnIndex + 1];
      if (bottom.position - top.position < MIN_GRID_CELL_SIZE) continue;
      if (right.position - left.position < MIN_GRID_CELL_SIZE) continue;
      const id = `cell:${top.id}:${bottom.id}:${left.id}:${right.id}`;
      cells.push({
        id,
        rowIndex,
        columnIndex,
        rowSpan: 1,
        columnSpan: 1,
        bbox: {
          x: left.position,
          y: top.position,
          width: right.position - left.position,
          height: bottom.position - top.position,
        },
        role: "unknown",
        ocrBlockIds: [],
        originalText: "",
        text: "",
        confidence: null,
        manuallyEdited: false,
        manuallyMerged: false,
        sourceCellIds: [id],
        warnings: [],
      });
    }
  }
  return cells;
}

function intersectionArea(block: OcrBlock, cell: GridCell): number {
  const left = Math.max(block.bbox.x, cell.bbox.x);
  const top = Math.max(block.bbox.y, cell.bbox.y);
  const right = Math.min(block.bbox.x + block.bbox.width, cell.bbox.x + cell.bbox.width);
  const bottom = Math.min(block.bbox.y + block.bbox.height, cell.bbox.y + cell.bbox.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function containsCenter(block: OcrBlock, cell: GridCell): boolean {
  const x = block.bbox.x + block.bbox.width / 2;
  const y = block.bbox.y + block.bbox.height / 2;
  return (
    x >= cell.bbox.x &&
    x < cell.bbox.x + cell.bbox.width &&
    y >= cell.bbox.y &&
    y < cell.bbox.y + cell.bbox.height
  );
}

function joinBlocks(blocks: OcrBlock[], original: boolean): string {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.bbox.y - b.bbox.y ||
      a.lineIndex - b.lineIndex ||
      a.bbox.x - b.bbox.x ||
      a.orderIndex - b.orderIndex,
  );
  let result = "";
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    const text = original ? current.originalText : current.text;
    if (!previous) {
      result = text;
      continue;
    }
    const differentLine =
      current.lineIndex !== previous.lineIndex ||
      current.bbox.y > previous.bbox.y + previous.bbox.height * 0.65;
    const previousText = original ? previous.originalText : previous.text;
    const separator = differentLine
      ? "\n"
      : /[A-Za-z0-9]$/.test(previousText) && /^[A-Za-z0-9]/.test(text)
        ? " "
        : "";
    result += separator + text;
  }
  return result.trim();
}

export interface GridCellAssignment {
  cells: GridCell[];
  unassignedBlockIds: string[];
  warnings: ScheduleWarning[];
}

export function assignOcrBlocksToGridCellsDetailed(
  document: OcrDocument,
  grid: TableGrid,
): GridCellAssignment {
  const cells = buildGridCells(grid);
  const assigned = new Map<string, OcrBlock[]>();
  const ambiguous = new Set<string>();
  const unassignedBlockIds: string[] = [];
  for (const block of document.blocks) {
    if (block.ignored || !block.text.trim()) continue;
    const overlaps = cells
      .map((cell) => ({ cell, area: intersectionArea(block, cell) }))
      .filter((item) => item.area > 0)
      .sort((a, b) => b.area - a.area || a.cell.id.localeCompare(b.cell.id));
    const centerCell = cells.find((cell) => containsCenter(block, cell));
    const blockArea = Math.max(1, block.bbox.width * block.bbox.height);
    const best = overlaps[0];
    if (!best || best.area / blockArea < 0.2) {
      unassignedBlockIds.push(block.id);
      continue;
    }
    const selected = centerCell ?? best.cell;
    if (
      (centerCell && centerCell.id !== best.cell.id) ||
      (overlaps[1] && overlaps[1].area / best.area > 0.7)
    )
      ambiguous.add(selected.id);
    const current = assigned.get(selected.id) ?? [];
    current.push(block);
    assigned.set(selected.id, current);
  }

  const mapped = cells.map((cell) => {
    const blocks = assigned.get(cell.id) ?? [];
    const warnings: ScheduleWarning[] = ambiguous.has(cell.id)
      ? [
          {
            code: "COURSE_CELL_AMBIGUOUS_OCR",
            message: "有 OCR 文字跨越单元格边界，已保守分配到一个单元格，请确认。",
            severity: "warning",
            scope: "cell",
            targetId: cell.id,
          },
        ]
      : [];
    return {
      ...cell,
      ocrBlockIds: blocks.map((block) => block.id),
      originalText: joinBlocks(blocks, true),
      text: joinBlocks(blocks, false),
      confidence: blocks.length
        ? blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length
        : null,
      warnings,
    };
  });
  return {
    cells: mapped,
    unassignedBlockIds,
    warnings: mapped.flatMap((cell) => cell.warnings),
  };
}

export function assignOcrBlocksToGridCells(document: OcrDocument, grid: TableGrid): GridCell[] {
  return assignOcrBlocksToGridCellsDetailed(document, grid).cells;
}

export function moveGridLine(
  grid: TableGrid,
  lineId: string,
  requestedPosition: number,
): TableGrid {
  const horizontal = grid.horizontalLines.some((line) => line.id === lineId);
  const key = horizontal ? "horizontalLines" : "verticalLines";
  const limit = horizontal ? grid.imageHeight : grid.imageWidth;
  const lines = sortGridLines(grid[key]);
  const index = lines.findIndex((line) => line.id === lineId);
  if (index < 0 || lines[index].locked) return grid;
  const minimum = index === 0 ? 0 : lines[index - 1].position + MIN_GRID_CELL_SIZE;
  const maximum =
    index === lines.length - 1 ? limit : lines[index + 1].position - MIN_GRID_CELL_SIZE;
  const position = Math.max(minimum, Math.min(maximum, requestedPosition));
  return {
    ...grid,
    [key]: lines.map((line) =>
      line.id === lineId ? { ...line, position, origin: "manual" as const } : line,
    ),
  };
}

export function addGridLine(
  grid: TableGrid,
  orientation: GridLine["orientation"],
  position: number,
): TableGrid {
  const key = orientation === "horizontal" ? "horizontalLines" : "verticalLines";
  const limit = orientation === "horizontal" ? grid.imageHeight : grid.imageWidth;
  const clamped = Math.max(0, Math.min(limit, position));
  const id = `manual-${orientation}-${Math.round(clamped * 1000)}`;
  if (grid[key].some((line) => line.id === id || Math.abs(line.position - clamped) < 0.001))
    return grid;
  return {
    ...grid,
    [key]: sortGridLines([
      ...grid[key],
      { id, orientation, position: clamped, confidence: 1, origin: "manual", locked: false },
    ]),
  };
}

export function removeGridLine(grid: TableGrid, lineId: string): TableGrid {
  const line = [...grid.horizontalLines, ...grid.verticalLines].find((item) => item.id === lineId);
  if (!line || line.locked) return grid;
  const key = line.orientation === "horizontal" ? "horizontalLines" : "verticalLines";
  return { ...grid, [key]: grid[key].filter((item) => item.id !== lineId) };
}

export function toggleGridLineLock(grid: TableGrid, lineId: string): TableGrid {
  const toggle = (line: GridLine) =>
    line.id === lineId ? { ...line, locked: !line.locked } : line;
  return {
    ...grid,
    horizontalLines: grid.horizontalLines.map(toggle),
    verticalLines: grid.verticalLines.map(toggle),
  };
}
