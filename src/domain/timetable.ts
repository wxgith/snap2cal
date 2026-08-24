import type { ConfidenceLevel, ExtractionWarning, SourceSpan } from "./event";

export type TimetableWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TimetableSourceKind = "text-table" | "ocr-geometry";
export type WeekParity = "all" | "odd" | "even";

export interface TimetablePeriod {
  label: string;
  startPeriod: number;
  endPeriod: number;
  startTime: string | null;
  endTime: string | null;
  source?: SourceSpan;
  confidence: ConfidenceLevel;
}

export interface TimetableWeekRange {
  startWeek: number;
  endWeek: number | null;
  parity: WeekParity;
  source?: SourceSpan;
  derivedFromDefault: boolean;
}

export interface TimetableCourseCell {
  id: string;
  title: string;
  location: string;
  weekday: TimetableWeekday;
  period: TimetablePeriod;
  weekRanges: TimetableWeekRange[];
  source: SourceSpan;
  titleSource?: SourceSpan;
  locationSource?: SourceSpan;
  confidence: ConfidenceLevel;
  warnings: ExtractionWarning[];
  selectedForExport: boolean;
  evidenceBlockIds: string[];
  manuallyEdited: boolean;
}

export interface TimetableExtractionResult {
  id: string;
  sourceKind: TimetableSourceKind;
  originalText: string;
  cells: TimetableCourseCell[];
  warnings: ExtractionWarning[];
  parseContext: {
    referenceDateTime: string;
    timeZone: string;
  };
  detectedCount: number;
  selectedCount: number;
}

export const TIMETABLE_WEEKDAY_LABELS: Record<TimetableWeekday, string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  7: "周日",
};
