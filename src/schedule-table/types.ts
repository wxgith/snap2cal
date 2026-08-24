import type { ExtractedField, SourceSpan, WarningSeverity, EventDraft } from "../domain/event";
import type { BoundingBox } from "../ocr/types";

export type ScheduleWarningCode =
  | "GRID_NOT_DETECTED"
  | "GRID_LOW_CONFIDENCE"
  | "GRID_TOO_FEW_ROWS"
  | "GRID_TOO_FEW_COLUMNS"
  | "GRID_DUPLICATE_LINE"
  | "GRID_CELL_TOO_SMALL"
  | "GRID_MANUAL_CONFIRMATION_REQUIRED"
  | "WEEKDAY_HEADER_NOT_FOUND"
  | "DUPLICATE_WEEKDAY_MAPPING"
  | "TIME_HEADER_NOT_FOUND"
  | "TIME_SLOT_MISSING"
  | "TIME_SLOT_INVALID"
  | "TIME_SLOT_OVERLAP"
  | "COURSE_CELL_EMPTY"
  | "COURSE_TITLE_MISSING"
  | "COURSE_LOCATION_UNCERTAIN"
  | "COURSE_TEACHER_UNCERTAIN"
  | "COURSE_WEEK_PATTERN_MISSING"
  | "COURSE_WEEK_PATTERN_INVALID"
  | "COURSE_HORIZONTAL_SPAN_UNSUPPORTED"
  | "COURSE_CELL_AMBIGUOUS_OCR"
  | "WEEK_ONE_MONDAY_REQUIRED"
  | "TOTAL_WEEKS_INVALID"
  | "OCCURRENCE_LIMIT_EXCEEDED"
  | "COURSE_CONFLICT_DETECTED"
  | "NO_COURSES_SELECTED"
  | "NO_VALID_OCCURRENCES";

export type ScheduleWarningScope = "grid" | "cell" | "template" | "occurrence" | "export";

export interface ScheduleWarning {
  code: ScheduleWarningCode;
  message: string;
  severity: WarningSeverity;
  scope: ScheduleWarningScope;
  targetId?: string;
}

export type GridLineOrientation = "horizontal" | "vertical";
export type GridLineOrigin = "detected" | "manual";

export interface GridLine {
  id: string;
  orientation: GridLineOrientation;
  position: number;
  confidence: number;
  origin: GridLineOrigin;
  locked: boolean;
}

export interface TableGrid {
  imageWidth: number;
  imageHeight: number;
  horizontalLines: GridLine[];
  verticalLines: GridLine[];
  confidence: number;
  warnings: ScheduleWarning[];
}

export type GridCellRole =
  "unknown" | "corner" | "weekday-header" | "time-header" | "course" | "ignored";

export interface GridCell {
  id: string;
  rowIndex: number;
  columnIndex: number;
  rowSpan: number;
  columnSpan: number;
  bbox: BoundingBox;
  role: GridCellRole;
  ocrBlockIds: string[];
  originalText: string;
  text: string;
  confidence: number | null;
  manuallyEdited: boolean;
  manuallyMerged: boolean;
  sourceCellIds: string[];
  warnings: ScheduleWarning[];
}

export interface CellTextDocument {
  cellId: string;
  ocrBlockIds: string[];
  originalText: string;
  text: string;
  confidence: number | null;
  warnings: ScheduleWarning[];
}

export type ScheduleWeekday =
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface WeekdayColumnMapping {
  columnIndex: number;
  weekday: ScheduleWeekday;
  sourceCellId: string;
  manuallyConfirmed: boolean;
}

export interface ScheduleHeaderMapping {
  weekdayHeaderRowIndex: number | null;
  timeHeaderColumnIndex: number | null;
  weekdayMappings: WeekdayColumnMapping[];
  manuallyConfirmed: boolean;
}

export interface ScheduleTimeSlot {
  rowIndex: number;
  label: string;
  startTime: string | null;
  endTime: string | null;
  sourceCellId?: string;
  manuallyEdited: boolean;
}

export type WeekPatternKind = "all" | "odd" | "even" | "explicit";

export interface WeekPattern {
  kind: WeekPatternKind;
  weeks: number[];
  originalExpression?: string;
  source?: SourceSpan;
  derivedFromDefault: boolean;
  manuallyEdited: boolean;
}

export interface ScheduleConfig {
  weekOneMonday: string | null;
  totalWeeks: number;
  timeZone: string;
  defaultReminderMinutes: number | null;
  defaultWeekPattern: WeekPattern;
}

export interface CourseTemplate {
  id: string;
  sourceCellIds: string[];
  weekday: ScheduleWeekday;
  startRowIndex: number;
  endRowIndex: number;
  title: ExtractedField<string>;
  location: ExtractedField<string>;
  teacher: ExtractedField<string>;
  description: ExtractedField<string>;
  startTime: ExtractedField<string | null>;
  endTime: ExtractedField<string | null>;
  weekPattern: WeekPattern;
  selectedForExport: boolean;
  manuallyConfirmed: boolean;
  manuallyEdited: boolean;
  warnings: ScheduleWarning[];
}

export interface CourseOccurrence {
  id: string;
  templateId: string;
  weekNumber: number;
  date: string;
  event: EventDraft;
  selectedForExport: boolean;
  excludedByUser: boolean;
  warnings: ScheduleWarning[];
}

export interface CourseScheduleResult {
  grid: TableGrid;
  cells: GridCell[];
  weekdayMappings: WeekdayColumnMapping[];
  timeSlots: ScheduleTimeSlot[];
  config: ScheduleConfig;
  templates: CourseTemplate[];
  occurrences: CourseOccurrence[];
  warnings: ScheduleWarning[];
}

export interface GridDetectionProgress {
  stage:
    | "preparing-image"
    | "detecting-horizontal-lines"
    | "detecting-vertical-lines"
    | "merging-lines"
    | "building-grid"
    | "completed";
  progress: number;
  message: string;
}

export interface GridDetectionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: GridDetectionProgress) => void;
}

export interface GridDetector {
  detect(image: ImageData, options?: GridDetectionOptions): Promise<TableGrid>;
}

export const SCHEDULE_WEEKDAYS: ScheduleWeekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const SCHEDULE_WEEKDAY_LABELS: Record<ScheduleWeekday, string> = {
  monday: "周一",
  tuesday: "周二",
  wednesday: "周三",
  thursday: "周四",
  friday: "周五",
  saturday: "周六",
  sunday: "周日",
};
