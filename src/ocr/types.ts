import type { EditableFieldName } from "../domain/event";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrRawBlock {
  text: string;
  confidence: number;
  bbox: BoundingBox;
  lineIndex: number;
  orderIndex: number;
}

export interface OcrRawResult {
  blocks: OcrRawBlock[];
}

export interface OcrBlock extends OcrRawBlock {
  id: string;
  originalText: string;
  manuallyEdited: boolean;
  ignored: boolean;
}

export interface OcrTextSegment {
  blockId: string;
  startIndex: number;
  endIndex: number;
}

export interface OcrDocument {
  id: string;
  naturalWidth: number;
  naturalHeight: number;
  blocks: OcrBlock[];
  combinedText: string;
  segments: OcrTextSegment[];
  averageConfidence: number | null;
}

export interface OcrEvidence {
  blockIds: string[];
  bbox: BoundingBox | null;
  confidence: number | null;
  containsManualCorrection: boolean;
}

export interface CandidateOcrEvidence {
  candidate: OcrEvidence;
  fields: Partial<Record<EditableFieldName, OcrEvidence>>;
}

export type OcrProgressStage =
  | "idle"
  | "loading-engine"
  | "loading-language"
  | "recognizing"
  | "building-document"
  | "completed";

export interface OcrProgress {
  stage: OcrProgressStage;
  progress: number;
  message: string;
}

export interface OcrRecognizeOptions {
  languages: string[];
  signal?: AbortSignal;
  onProgress?: (progress: OcrProgress) => void;
}

export interface OcrAdapter {
  recognize(image: Blob, options: OcrRecognizeOptions): Promise<OcrRawResult>;
  dispose(): Promise<void>;
}

export class OcrError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}
