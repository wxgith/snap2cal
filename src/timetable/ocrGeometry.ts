import type { ExtractionWarning, SourceSpan } from "../domain/event";
import type { TimetableCourseCell, TimetableExtractionResult } from "../domain/timetable";
import type { OcrBlock, OcrDocument, OcrEvidence } from "../ocr/types";
import type { ParseEventTextOptions } from "../parser";
import { createTimetableCellFromOcrText, parseTimetablePeriod, parseWeekdayLabel } from "./parser";

interface OcrHeader {
  block: OcrBlock;
  weekday: NonNullable<ReturnType<typeof parseWeekdayLabel>>;
  centerX: number;
}

interface OcrRow {
  block: OcrBlock;
  period: NonNullable<ReturnType<typeof parseTimetablePeriod>>;
  centerY: number;
}

function centerX(block: OcrBlock): number {
  return block.bbox.x + block.bbox.width / 2;
}

function centerY(block: OcrBlock): number {
  return block.bbox.y + block.bbox.height / 2;
}

function blockSource(document: OcrDocument, blockId: string): SourceSpan | undefined {
  const segment = document.segments.find((item) => item.blockId === blockId);
  if (!segment) return undefined;
  return {
    text: document.combinedText.slice(segment.startIndex, segment.endIndex),
    startIndex: segment.startIndex,
    endIndex: segment.endIndex,
  };
}

function sourceFromBlocks(document: OcrDocument, blocks: OcrBlock[]): SourceSpan {
  const ranges = blocks
    .map((block) => document.segments.find((segment) => segment.blockId === block.id))
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));
  if (!ranges.length) {
    const text = blocks.map((block) => block.text).join(" ");
    return { text, startIndex: 0, endIndex: text.length };
  }
  const startIndex = Math.min(...ranges.map((range) => range.startIndex));
  const endIndex = Math.max(...ranges.map((range) => range.endIndex));
  return {
    text: document.combinedText.slice(startIndex, endIndex),
    startIndex,
    endIndex,
  };
}

function nearestByDistance<T>(items: T[], distance: (item: T) => number): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const nextDistance = distance(item);
    if (nextDistance < bestDistance) {
      best = item;
      bestDistance = nextDistance;
    }
  }
  return best;
}

function groupBlocksByCell(headers: OcrHeader[], rows: OcrRow[], blocks: OcrBlock[]) {
  const headerIds = new Set(headers.map((header) => header.block.id));
  const rowIds = new Set(rows.map((row) => row.block.id));
  const groups = new Map<string, { header: OcrHeader; row: OcrRow; blocks: OcrBlock[] }>();
  for (const block of blocks) {
    if (headerIds.has(block.id) || rowIds.has(block.id) || !block.text.trim()) continue;
    const header = nearestByDistance(headers, (item) => Math.abs(centerX(block) - item.centerX));
    const row = nearestByDistance(rows, (item) => Math.abs(centerY(block) - item.centerY));
    if (!header || !row) continue;
    if (centerY(block) < Math.min(...headers.map((item) => centerY(item.block)))) continue;
    const key = `${header.weekday}-${row.period.startPeriod}-${row.period.endPeriod}`;
    const current = groups.get(key) ?? { header, row, blocks: [] };
    current.blocks.push(block);
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function parseTimetableFromOcrDocument(
  document: OcrDocument,
  options: ParseEventTextOptions,
): TimetableExtractionResult {
  const warnings: ExtractionWarning[] = [];
  const includedBlocks = document.blocks.filter((block) => !block.ignored && block.text.trim());
  const headers: OcrHeader[] = includedBlocks
    .map((block) => ({ block, weekday: parseWeekdayLabel(block.text), centerX: centerX(block) }))
    .filter(
      (item): item is OcrHeader =>
        item.weekday !== null && item.block.bbox.y < document.naturalHeight * 0.45,
    )
    .sort((a, b) => a.centerX - b.centerX);
  const firstHeaderCenterX = Math.min(...headers.map((header) => header.centerX));
  const rows: OcrRow[] = includedBlocks
    .map((block) => {
      if (headers.length > 0 && centerX(block) >= firstHeaderCenterX) return null;
      const source = blockSource(document, block.id);
      const period = parseTimetablePeriod({
        text: block.text,
        startIndex: source?.startIndex ?? 0,
        endIndex: source?.endIndex ?? block.text.length,
      });
      return period ? { block, period, centerY: centerY(block) } : null;
    })
    .filter((item): item is OcrRow => item !== null)
    .sort((a, b) => a.centerY - b.centerY);

  if (headers.length < 2)
    warnings.push({
      code: "TIMETABLE_OCR_HEADERS_NOT_FOUND",
      message: "OCR 几何识别没有找到至少两个星期表头，请校对文字或改用文本表格。",
      severity: "error",
    });
  if (rows.length === 0)
    warnings.push({
      code: "TIMETABLE_OCR_ROWS_NOT_FOUND",
      message: "OCR 几何识别没有找到节次和起止时间行，请校对左侧节次文字。",
      severity: "error",
    });
  if (document.averageConfidence !== null && document.averageConfidence < 0.65)
    warnings.push({
      code: "TIMETABLE_OCR_LOW_CONFIDENCE",
      message: "OCR 平均置信度较低，课程表行列和课程名称需要逐项确认。",
      severity: "warning",
    });

  const cells: TimetableCourseCell[] = [];
  for (const group of groupBlocksByCell(headers, rows, includedBlocks)) {
    const blocks = group.blocks.sort(
      (a, b) => centerY(a) - centerY(b) || centerX(a) - centerX(b) || a.id.localeCompare(b.id),
    );
    const source = sourceFromBlocks(document, blocks);
    const text = blocks.map((block) => block.text).join(" ");
    const cell = createTimetableCellFromOcrText(
      { text, startIndex: source.startIndex, endIndex: source.endIndex },
      group.header.weekday,
      group.row.period,
      cells.length,
      blocks.map((block) => block.id),
    );
    cells.push({
      ...cell,
      id: `ocr-${cell.id}`,
      source,
      confidence:
        cell.confidence === "low" || blocks.some((block) => block.confidence < 0.65)
          ? "low"
          : cell.confidence,
    });
  }

  if (headers.length >= 2 && rows.length > 0 && cells.length === 0)
    warnings.push({
      code: "TIMETABLE_OCR_NO_COURSES",
      message: "已识别表头和节次，但未能把 OCR 文本块归入课程单元格。",
      severity: "warning",
    });

  return {
    id: `timetable-ocr-${document.id}`,
    sourceKind: "ocr-geometry",
    originalText: document.combinedText,
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

export function mapTimetableCellToOcrEvidence(
  cell: TimetableCourseCell | null,
  document: OcrDocument | null,
): OcrEvidence | null {
  if (!cell || !document || cell.evidenceBlockIds.length === 0)
    return { blockIds: [], bbox: null, confidence: null, containsManualCorrection: false };
  const blocks = cell.evidenceBlockIds
    .map((id) => document.blocks.find((block) => block.id === id))
    .filter((block): block is OcrBlock => Boolean(block));
  if (!blocks.length)
    return { blockIds: [], bbox: null, confidence: null, containsManualCorrection: false };
  const left = Math.min(...blocks.map((block) => block.bbox.x));
  const top = Math.min(...blocks.map((block) => block.bbox.y));
  const right = Math.max(...blocks.map((block) => block.bbox.x + block.bbox.width));
  const bottom = Math.max(...blocks.map((block) => block.bbox.y + block.bbox.height));
  return {
    blockIds: blocks.map((block) => block.id),
    bbox: { x: left, y: top, width: right - left, height: bottom - top },
    confidence: Math.min(...blocks.map((block) => block.confidence)),
    containsManualCorrection: blocks.some((block) => block.manuallyEdited),
  };
}
