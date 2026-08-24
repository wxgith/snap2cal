export type ConfidenceLevel = "high" | "medium" | "low";
export type WarningSeverity = "info" | "warning" | "error";

export interface SourceSpan {
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface ExtractedField<T> {
  value: T;
  source?: SourceSpan;
  confidence: ConfidenceLevel;
  manuallyEdited: boolean;
  derivedFromDefault: boolean;
}

export interface ExtractionWarning {
  code: string;
  message: string;
  severity: WarningSeverity;
  relatedField?: keyof EventDraft;
}

export interface ParseContext {
  referenceDateTime: string;
  timeZone: string;
}

export interface EventDraft {
  id: string;
  originalText: string;
  title: ExtractedField<string>;
  startDate: ExtractedField<string | null>;
  startTime: ExtractedField<string | null>;
  endDate: ExtractedField<string | null>;
  endTime: ExtractedField<string | null>;
  location: ExtractedField<string>;
  description: ExtractedField<string>;
  reminderMinutes: ExtractedField<number | null>;
  allDay: ExtractedField<boolean>;
  timeZone: ExtractedField<string>;
  warnings: ExtractionWarning[];
  parseContext: ParseContext;
}

export type EditableFieldName = Exclude<
  keyof EventDraft,
  "id" | "originalText" | "warnings" | "parseContext"
>;

export function createField<T>(
  value: T,
  confidence: ConfidenceLevel = "low",
  source?: SourceSpan,
  derivedFromDefault = false,
): ExtractedField<T> {
  return { value, confidence, source, manuallyEdited: false, derivedFromDefault };
}

export function makeSource(input: string, startIndex: number, text: string): SourceSpan {
  return { text, startIndex, endIndex: startIndex + text.length };
}
