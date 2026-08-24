import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { GridCell, GridLine, TableGrid } from "../schedule-table";

interface Props {
  grid: TableGrid | null;
  cells: GridCell[];
  selectedLineId: string | null;
  selectedCellIds: ReadonlySet<string>;
  onSelectLine: (lineId: string) => void;
  onMoveLine: (lineId: string, position: number) => void;
  onToggleCell: (cellId: string) => void;
  testId?: string;
}

function naturalPosition(event: PointerEvent<SVGLineElement>, line: GridLine): number {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return line.position;
  const bounds = svg.getBoundingClientRect();
  if (line.orientation === "horizontal")
    return ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * svg.viewBox.baseVal.height;
  return ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * svg.viewBox.baseVal.width;
}

export function ScheduleGridOverlay({
  grid,
  cells,
  selectedLineId,
  selectedCellIds,
  onSelectLine,
  onMoveLine,
  onToggleCell,
  testId = "schedule-grid-overlay",
}: Props) {
  const draggingLineIdRef = useRef<string | null>(null);
  if (!grid) return null;
  const onKeyDown = (event: KeyboardEvent<SVGLineElement>, line: GridLine) => {
    const step = event.shiftKey ? 10 : 1;
    const delta =
      line.orientation === "horizontal"
        ? event.key === "ArrowUp"
          ? -step
          : event.key === "ArrowDown"
            ? step
            : 0
        : event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
    if (!delta || line.locked) return;
    event.preventDefault();
    onMoveLine(line.id, line.position + delta);
  };
  return (
    <g className="schedule-grid-overlay" data-testid={testId}>
      {cells.map((cell) => (
        <rect
          key={cell.id}
          x={cell.bbox.x}
          y={cell.bbox.y}
          width={cell.bbox.width}
          height={cell.bbox.height}
          className={`schedule-cell-boundary ${selectedCellIds.has(cell.id) ? "selected" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={`选择单元格 ${cell.rowIndex + 1}-${cell.columnIndex + 1}`}
          aria-pressed={selectedCellIds.has(cell.id)}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCell(cell.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleCell(cell.id);
            }
          }}
        />
      ))}
      {[...grid.horizontalLines, ...grid.verticalLines].map((line) => (
        <line
          key={line.id}
          x1={line.orientation === "horizontal" ? 0 : line.position}
          x2={line.orientation === "horizontal" ? grid.imageWidth : line.position}
          y1={line.orientation === "horizontal" ? line.position : 0}
          y2={line.orientation === "horizontal" ? line.position : grid.imageHeight}
          className={`schedule-grid-line ${selectedLineId === line.id ? "selected" : ""} ${line.locked ? "locked" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={`${line.orientation === "horizontal" ? "水平" : "垂直"}网格线 ${Math.round(line.position)}${line.locked ? "，已锁定" : ""}`}
          aria-pressed={selectedLineId === line.id}
          onFocus={() => onSelectLine(line.id)}
          onPointerDown={(event) => {
            onSelectLine(line.id);
            if (!line.locked) {
              draggingLineIdRef.current = line.id;
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Synthetic and assistive pointer input may not support capture.
              }
            }
          }}
          onPointerMove={(event) => {
            if (
              !line.locked &&
              draggingLineIdRef.current === line.id &&
              (event.buttons === 1 || event.currentTarget.hasPointerCapture(event.pointerId))
            )
              onMoveLine(line.id, naturalPosition(event, line));
          }}
          onPointerUp={() => {
            draggingLineIdRef.current = null;
          }}
          onLostPointerCapture={() => {
            draggingLineIdRef.current = null;
          }}
          onKeyDown={(event) => onKeyDown(event, line)}
        />
      ))}
    </g>
  );
}
