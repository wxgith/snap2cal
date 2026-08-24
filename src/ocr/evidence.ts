import type { EditableFieldName, ExtractedField, SourceSpan } from "../domain/event";
import type { EventCandidate } from "../domain/multiEvent";
import type { BoundingBox, CandidateOcrEvidence, OcrDocument, OcrEvidence } from "./types";

export const EMPTY_OCR_EVIDENCE: OcrEvidence = {
  blockIds: [],
  bbox: null,
  confidence: null,
  containsManualCorrection: false,
};

function unionBoxes(boxes: BoundingBox[]): BoundingBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function mapSourceSpanToOcrEvidence(
  source: SourceSpan | undefined,
  document: OcrDocument,
): OcrEvidence {
  if (!source || source.endIndex <= source.startIndex) return EMPTY_OCR_EVIDENCE;
  const segmentIds = document.segments
    .filter(
      (segment) => source.startIndex < segment.endIndex && source.endIndex > segment.startIndex,
    )
    .map((segment) => segment.blockId);
  const idSet = new Set(segmentIds);
  const blocks = document.blocks.filter((block) => idSet.has(block.id) && !block.ignored);
  if (!blocks.length) return EMPTY_OCR_EVIDENCE;
  return {
    blockIds: blocks.map((block) => block.id),
    bbox: unionBoxes(blocks.map((block) => block.bbox)),
    confidence: Math.min(...blocks.map((block) => block.confidence)),
    containsManualCorrection: blocks.some((block) => block.manuallyEdited),
  };
}

const EVIDENCE_FIELDS: EditableFieldName[] = [
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

export function mapCandidateToOcrEvidence(
  candidate: EventCandidate,
  document: OcrDocument,
): CandidateOcrEvidence {
  const fields: Partial<Record<EditableFieldName, OcrEvidence>> = {};
  for (const name of EVIDENCE_FIELDS) {
    const field = candidate.draft[name] as ExtractedField<unknown>;
    fields[name] = mapSourceSpanToOcrEvidence(field.source, document);
  }
  return {
    candidate: mapSourceSpanToOcrEvidence(candidate.segment.source, document),
    fields,
  };
}
