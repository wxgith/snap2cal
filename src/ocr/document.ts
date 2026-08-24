import type { OcrBlock, OcrDocument, OcrRawResult, OcrTextSegment } from "./types";

function createId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Math.random().toString(36).slice(2)}`;
}

function isLatinBoundary(left: string, right: string): boolean {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

export function sortOcrBlocks(blocks: OcrBlock[]): OcrBlock[] {
  return [...blocks].sort(
    (a, b) =>
      a.lineIndex - b.lineIndex ||
      a.bbox.y - b.bbox.y ||
      a.bbox.x - b.bbox.x ||
      a.orderIndex - b.orderIndex ||
      a.id.localeCompare(b.id),
  );
}

export function rebuildOcrDocument(document: OcrDocument): OcrDocument {
  const blocks = sortOcrBlocks(document.blocks);
  const included = blocks.filter((block) => !block.ignored && block.text.length > 0);
  let combinedText = "";
  const segments: OcrTextSegment[] = [];
  let previous: OcrBlock | undefined;
  for (const block of included) {
    if (previous) {
      combinedText +=
        previous.lineIndex === block.lineIndex
          ? isLatinBoundary(previous.text, block.text)
            ? " "
            : ""
          : "\n";
    }
    const startIndex = combinedText.length;
    combinedText += block.text;
    segments.push({ blockId: block.id, startIndex, endIndex: combinedText.length });
    previous = block;
  }
  const averageConfidence = included.length
    ? included.reduce((sum, block) => sum + block.confidence, 0) / included.length
    : null;
  return { ...document, blocks, combinedText, segments, averageConfidence };
}

export function buildOcrDocument(
  raw: OcrRawResult,
  naturalWidth: number,
  naturalHeight: number,
): OcrDocument {
  const blocks: OcrBlock[] = raw.blocks.map((block, index) => ({
    ...block,
    id: `ocr-block-${index}-${createId("block")}`,
    originalText: block.text,
    confidence: Math.max(0, Math.min(1, block.confidence)),
    manuallyEdited: false,
    ignored: false,
  }));
  return rebuildOcrDocument({
    id: createId("ocr-document"),
    naturalWidth,
    naturalHeight,
    blocks,
    combinedText: "",
    segments: [],
    averageConfidence: null,
  });
}

export function editOcrBlock(document: OcrDocument, blockId: string, text: string): OcrDocument {
  return rebuildOcrDocument({
    ...document,
    blocks: document.blocks.map((block) =>
      block.id === blockId ? { ...block, text, manuallyEdited: true } : block,
    ),
  });
}

export function setOcrBlockIgnored(
  document: OcrDocument,
  blockId: string,
  ignored: boolean,
): OcrDocument {
  return rebuildOcrDocument({
    ...document,
    blocks: document.blocks.map((block) => (block.id === blockId ? { ...block, ignored } : block)),
  });
}
