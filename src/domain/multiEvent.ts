import type { ConfidenceLevel, EventDraft, ExtractionWarning, SourceSpan } from "./event";

export type EventCandidateStatus = "detected" | "confirmed" | "ignored" | "needs-review";
export type CandidateConfidence = ConfidenceLevel;

export type CandidateBoundaryReason =
  | "blank-line"
  | "bullet"
  | "numbered-item"
  | "date-prefix"
  | "time-prefix"
  | "explicit-label"
  | "shared-context"
  | "semicolon"
  | "single-event-fallback"
  | "manual-merge";

export interface InheritedContextValue {
  value: string;
  source: SourceSpan;
}

export interface CandidateInheritedContext {
  date?: InheritedContextValue;
  location?: InheritedContextValue;
  titlePrefix?: InheritedContextValue;
}

export interface CandidateSegment {
  id: string;
  source: SourceSpan;
  text: string;
  lineStart: number;
  lineEnd: number;
  boundaryReason: CandidateBoundaryReason;
  inheritedContext: CandidateInheritedContext;
}

export interface EventCandidate {
  id: string;
  segment: CandidateSegment;
  draft: EventDraft;
  status: EventCandidateStatus;
  selectedForExport: boolean;
  confidence: CandidateConfidence;
  reasons: string[];
  warnings: ExtractionWarning[];
  duplicateOf?: string;
  mergedFrom: string[];
  manuallyEdited: boolean;
}

export type UnassignedTextReason =
  "context-heading" | "unrecognized" | "separator" | "trailing-note" | "ambiguous";

export interface UnassignedTextFragment {
  source: SourceSpan;
  text: string;
  reason: UnassignedTextReason;
}

export interface MultiEventExtractionResult {
  originalText: string;
  candidates: EventCandidate[];
  unassignedText: UnassignedTextFragment[];
  warnings: ExtractionWarning[];
  parseContext: {
    referenceDateTime: string;
    timeZone: string;
  };
  detectedCount: number;
  selectedCount: number;
}

export interface CandidateMergeOperation {
  result: MultiEventExtractionResult;
  previous: MultiEventExtractionResult;
  mergedCandidateId: string;
}
