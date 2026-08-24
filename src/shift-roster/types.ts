import type { EventDraft, WarningSeverity } from "../domain/event";
import type { BoundingBox } from "../ocr/types";
import type { TableGrid } from "../schedule-table";

export const ROSTER_LIMITS = {
  maxPeople: 100,
  maxDateColumns: 31,
  maxAssignments: 3100,
  maxOccurrences: 3100,
} as const;

export type RosterWarningCode =
  | "ROSTER_GRID_NOT_CONFIRMED"
  | "ROSTER_DATE_HEADER_NOT_FOUND"
  | "ROSTER_PERSON_COLUMN_NOT_FOUND"
  | "ROSTER_DATA_REGION_INVALID"
  | "ROSTER_YEAR_REQUIRED"
  | "ROSTER_MONTH_REQUIRED"
  | "ROSTER_DATE_INVALID"
  | "ROSTER_DATE_DUPLICATE"
  | "ROSTER_DATE_OUT_OF_ORDER"
  | "ROSTER_WEEKDAY_MISMATCH"
  | "ROSTER_DATE_COLUMN_LIMIT_EXCEEDED"
  | "ROSTER_PERSON_NAME_MISSING"
  | "ROSTER_DUPLICATE_PERSON_NAME"
  | "ROSTER_PERSON_LIMIT_EXCEEDED"
  | "SHIFT_CODE_UNMAPPED"
  | "SHIFT_CODE_ALIAS_CONFLICT"
  | "SHIFT_DEFINITION_UNCONFIRMED"
  | "SHIFT_NAME_MISSING"
  | "SHIFT_TIME_MISSING"
  | "SHIFT_TIME_INVALID"
  | "SHIFT_CROSS_MIDNIGHT_REQUIRED"
  | "SHIFT_CROSS_MIDNIGHT_INVALID"
  | "SHIFT_TWENTY_FOUR_HOUR_UNSUPPORTED"
  | "SHIFT_MULTIPLE_CODES_UNSUPPORTED"
  | "ASSIGNMENT_DUPLICATE"
  | "ASSIGNMENT_LOW_OCR_CONFIDENCE"
  | "ASSIGNMENT_IGNORED"
  | "ASSIGNMENT_LIMIT_EXCEEDED"
  | "SHIFT_OCCURRENCE_CONFLICT"
  | "SHIFT_OCCURRENCE_INVALID"
  | "NO_PEOPLE_SELECTED"
  | "NO_VALID_SHIFT_OCCURRENCES"
  | "ROSTER_DATE_DERIVED"
  | "ROSTER_TEAM_TITLE_WITHOUT_PERSON";

export type RosterWarningScope =
  "grid" | "date" | "person" | "definition" | "assignment" | "occurrence" | "export";

export interface RosterWarning {
  code: RosterWarningCode;
  message: string;
  severity: WarningSeverity;
  scope: RosterWarningScope;
  targetId?: string;
}

export type RosterCellRole =
  | "unknown"
  | "corner"
  | "date-header"
  | "weekday-header"
  | "person-header"
  | "assignment"
  | "ignored";

export interface RosterCell {
  gridCellId: string;
  rowIndex: number;
  columnIndex: number;
  bbox: BoundingBox;
  ocrBlockIds: string[];
  confidence: number | null;
  role: RosterCellRole;
  originalText: string;
  text: string;
  manuallyEdited: boolean;
  warnings: RosterWarning[];
}

export interface RosterHeaderMapping {
  dateHeaderRowIndex: number | null;
  weekdayHeaderRowIndex: number | null;
  personColumnIndex: number | null;
  firstPersonRowIndex: number | null;
  lastPersonRowIndex: number | null;
  firstDateColumnIndex: number | null;
  lastDateColumnIndex: number | null;
  manuallyConfirmed: boolean;
}

export interface RosterDateColumn {
  id: string;
  columnIndex: number;
  sourceCellId: string;
  originalText: string;
  date: string | null;
  weekdayText?: string;
  weekdayMatchesDate?: boolean;
  derivedFromYearMonth: boolean;
  manuallyEdited: boolean;
  warnings: RosterWarning[];
}

export interface RosterPerson {
  id: string;
  rowIndex: number;
  sourceCellId: string;
  originalText: string;
  displayName: string;
  employeeId?: string;
  selectedForExport: boolean;
  manuallyEdited: boolean;
  warnings: RosterWarning[];
}

export type ShiftDefinitionKind = "timed" | "all-day" | "skip";

export interface ShiftDefinition {
  id: string;
  primaryCode: string;
  aliases: string[];
  displayName: string;
  kind: ShiftDefinitionKind;
  startTime: string | null;
  endTime: string | null;
  crossesMidnight: boolean;
  location: string;
  description: string;
  reminderMinutes: number | null;
  manuallyConfirmed: boolean;
  warnings: RosterWarning[];
}

export type ShiftAssignmentStatus = "mapped" | "unmapped" | "empty" | "ignored" | "needs-review";

export interface ShiftAssignment {
  id: string;
  personId: string;
  dateColumnId: string;
  sourceCellId: string;
  originalText: string;
  normalizedCode: string;
  shiftDefinitionId: string | null;
  status: ShiftAssignmentStatus;
  selectedForExport: boolean;
  manuallyEdited: boolean;
  warnings: RosterWarning[];
}

export interface ShiftCodeCatalogEntry {
  normalizedCode: string;
  originalForms: string[];
  occurrenceCount: number;
  personCount: number;
  firstDate: string | null;
  lastDate: string | null;
  averageConfidence: number | null;
  shiftDefinitionId: string | null;
  exampleCellId: string;
}

export interface RosterConfig {
  rosterYear: number | null;
  rosterMonth: number | null;
  timeZone: string;
  exportMode: "individual" | "team";
  includePersonNameInTitle: boolean;
  defaultReminderMinutes: number | null;
}

export interface ShiftOccurrence {
  id: string;
  assignmentId: string;
  personId: string;
  shiftDefinitionId: string;
  rosterDate: string;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  event: EventDraft;
  selectedForExport: boolean;
  excludedByUser: boolean;
  warnings: RosterWarning[];
}

export interface ShiftRosterResult {
  grid: TableGrid;
  cells: RosterCell[];
  dateColumns: RosterDateColumn[];
  people: RosterPerson[];
  shiftDefinitions: ShiftDefinition[];
  assignments: ShiftAssignment[];
  occurrences: ShiftOccurrence[];
  unmappedCodes: string[];
  warnings: RosterWarning[];
  config: RosterConfig;
}
