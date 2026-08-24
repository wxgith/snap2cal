import type { ConfidenceLevel, ExtractionWarning, SourceSpan } from "../domain/event";

export interface ParseEventTextOptions {
  referenceDateTime: Date;
  timeZone: string;
}

export interface RuleMatch<T> {
  value: T;
  source: SourceSpan;
  confidence: ConfidenceLevel;
  derivedFromDefault?: boolean;
  warnings: ExtractionWarning[];
}
