import { createField, type EventDraft, type ExtractionWarning } from "../domain/event";
import { validateEvent } from "../domain/validation";
import { addCalendarDays, formatDate, isValidDate } from "../utils/date";
import { validateShiftDefinition } from "./shifts";
import type {
  RosterConfig,
  RosterDateColumn,
  RosterPerson,
  RosterWarning,
  ShiftAssignment,
  ShiftDefinition,
  ShiftOccurrence,
} from "./types";
import { ROSTER_LIMITS } from "./types";

function nextCalendarDate(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (!isValidDate(parts.year, parts.month, parts.day)) return null;
  return formatDate(addCalendarDays(parts, 1));
}

function createOccurrenceEvent(
  id: string,
  assignment: ShiftAssignment,
  person: RosterPerson,
  date: RosterDateColumn,
  definition: ShiftDefinition,
  config: RosterConfig,
  endDate: string,
): EventDraft {
  const description = [
    definition.description,
    `人员：${person.displayName}${person.employeeId ? `（${person.employeeId}）` : ""}`,
    `原始班次代码：${assignment.originalText || assignment.normalizedCode}`,
    `排班日期：${date.date}`,
  ]
    .filter(Boolean)
    .join("\n");
  const warnings: ExtractionWarning[] = [
    {
      code: "ROSTER_DATE_DERIVED",
      message: "事件日期来自用户确认的排班日期列，请确认。",
      severity: "info",
      relatedField: "startDate",
    },
  ];
  const allDay = definition.kind === "all-day";
  return {
    id,
    originalText: assignment.originalText,
    title: { ...createField(definition.displayName, "high"), manuallyEdited: true },
    startDate: createField(date.date, "high", undefined, true),
    startTime: allDay
      ? createField(null, "high", undefined, true)
      : { ...createField(definition.startTime, "high"), manuallyEdited: true },
    endDate: createField(endDate, "high", undefined, true),
    endTime: allDay
      ? createField(null, "high", undefined, true)
      : { ...createField(definition.endTime, "high"), manuallyEdited: true },
    location: { ...createField(definition.location, "high"), manuallyEdited: true },
    description: { ...createField(description, "high"), manuallyEdited: true },
    reminderMinutes: createField(
      definition.reminderMinutes ?? config.defaultReminderMinutes,
      "high",
      undefined,
      definition.reminderMinutes === null,
    ),
    allDay: createField(allDay, "high", undefined, true),
    timeZone: createField(config.timeZone, "high", undefined, true),
    warnings,
    parseContext: {
      referenceDateTime: `${date.date ?? "1970-01-01"}T00:00:00.000Z`,
      timeZone: config.timeZone,
    },
  };
}

export interface ShiftOccurrenceGenerationItem {
  occurrence: ShiftOccurrence | null;
  warnings: RosterWarning[];
}

export function generateShiftOccurrence(
  assignment: ShiftAssignment,
  person: RosterPerson,
  date: RosterDateColumn,
  definition: ShiftDefinition,
  config: RosterConfig,
  excludedOccurrenceIds: ReadonlySet<string> = new Set(),
): ShiftOccurrenceGenerationItem {
  if (definition.kind === "skip") return { occurrence: null, warnings: [] };
  const warnings: RosterWarning[] = [];
  if (assignment.status !== "mapped" || !date.date) {
    warnings.push({
      code: "SHIFT_OCCURRENCE_INVALID",
      message: `${person.displayName} 的班次 assignment 或日期无效。`,
      severity: "error",
      scope: "occurrence",
      targetId: assignment.id,
    });
    return { occurrence: null, warnings };
  }
  const definitionWarnings = validateShiftDefinition(definition).filter(
    (warning) => warning.severity === "error",
  );
  if (definitionWarnings.length) return { occurrence: null, warnings: definitionWarnings };
  const endDate =
    definition.kind === "timed" && definition.crossesMidnight
      ? nextCalendarDate(date.date)
      : date.date;
  if (!endDate) {
    warnings.push({
      code: "SHIFT_OCCURRENCE_INVALID",
      message: `${date.date} 无法进行日历日期运算。`,
      severity: "error",
      scope: "occurrence",
      targetId: assignment.id,
    });
    return { occurrence: null, warnings };
  }
  const id = `shift-occurrence:${assignment.id}:${definition.id}:${date.date}`;
  const event = createOccurrenceEvent(id, assignment, person, date, definition, config, endDate);
  const eventErrors = validateEvent(event);
  if (eventErrors.length) {
    warnings.push({
      code: "SHIFT_OCCURRENCE_INVALID",
      message: eventErrors.map((error) => error.message).join(" "),
      severity: "error",
      scope: "occurrence",
      targetId: assignment.id,
    });
    return { occurrence: null, warnings };
  }
  return {
    occurrence: {
      id,
      assignmentId: assignment.id,
      personId: person.id,
      shiftDefinitionId: definition.id,
      rosterDate: date.date,
      startDate: date.date,
      startTime: definition.kind === "timed" ? definition.startTime : null,
      endDate,
      endTime: definition.kind === "timed" ? definition.endTime : null,
      event,
      selectedForExport: assignment.selectedForExport && person.selectedForExport,
      excludedByUser: excludedOccurrenceIds.has(id),
      warnings: [],
    },
    warnings,
  };
}

function dateOrdinal(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 60000;
}

function timeMinutes(time: string | null): number {
  if (!time) return 0;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function interval(occurrence: ShiftOccurrence): [number, number] {
  const startDay = dateOrdinal(occurrence.startDate);
  if (occurrence.event.allDay.value) return [startDay, dateOrdinal(occurrence.endDate) + 24 * 60];
  return [
    startDay + timeMinutes(occurrence.startTime),
    dateOrdinal(occurrence.endDate) + timeMinutes(occurrence.endTime),
  ];
}

export function detectShiftConflicts(occurrences: ShiftOccurrence[]): ShiftOccurrence[] {
  const conflicts = new Map<string, Set<string>>();
  const active = occurrences.filter(
    (occurrence) => occurrence.selectedForExport && !occurrence.excludedByUser,
  );
  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    const first = active[firstIndex];
    const [firstStart, firstEnd] = interval(first);
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const second = active[secondIndex];
      if (first.personId !== second.personId) continue;
      const [secondStart, secondEnd] = interval(second);
      if (firstStart < secondEnd && secondStart < firstEnd) {
        const firstSet = conflicts.get(first.id) ?? new Set<string>();
        firstSet.add(second.event.title.value);
        conflicts.set(first.id, firstSet);
        const secondSet = conflicts.get(second.id) ?? new Set<string>();
        secondSet.add(first.event.title.value);
        conflicts.set(second.id, secondSet);
      }
    }
  }
  return occurrences.map((occurrence) => {
    const names = conflicts.get(occurrence.id);
    return {
      ...occurrence,
      warnings: [
        ...occurrence.warnings.filter((warning) => warning.code !== "SHIFT_OCCURRENCE_CONFLICT"),
        ...(names
          ? [
              {
                code: "SHIFT_OCCURRENCE_CONFLICT" as const,
                message: `${occurrence.startDate} 的“${occurrence.event.title.value}”与 ${[...names].join("、")} 时间重叠；仅提示，不自动删除。`,
                severity: "warning" as const,
                scope: "occurrence" as const,
                targetId: occurrence.id,
              },
            ]
          : []),
      ],
    };
  });
}

export interface ShiftOccurrenceGenerationResult {
  occurrences: ShiftOccurrence[];
  warnings: RosterWarning[];
}

export function generateShiftOccurrences(
  assignments: ShiftAssignment[],
  people: RosterPerson[],
  dates: RosterDateColumn[],
  definitions: ShiftDefinition[],
  config: RosterConfig,
  excludedOccurrenceIds: ReadonlySet<string> = new Set(),
): ShiftOccurrenceGenerationResult {
  const warnings: RosterWarning[] = [];
  const selectedPeople = people.filter((person) => person.selectedForExport);
  if (!selectedPeople.length)
    warnings.push({
      code: "NO_PEOPLE_SELECTED",
      message: "请至少选择一个人员。",
      severity: "error",
      scope: "export",
    });
  const personMap = new Map(people.map((person) => [person.id, person]));
  const dateMap = new Map(dates.map((date) => [date.id, date]));
  const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
  const occurrences: ShiftOccurrence[] = [];
  for (const assignment of assignments) {
    const person = personMap.get(assignment.personId);
    if (!person?.selectedForExport || !assignment.normalizedCode) continue;
    if (assignment.status === "empty" || assignment.status === "ignored") continue;
    const date = dateMap.get(assignment.dateColumnId);
    const definition = assignment.shiftDefinitionId
      ? definitionMap.get(assignment.shiftDefinitionId)
      : undefined;
    if (!date || !definition) {
      warnings.push(...assignment.warnings);
      continue;
    }
    if (definition.kind === "skip") continue;
    if (occurrences.length >= ROSTER_LIMITS.maxOccurrences) {
      warnings.push({
        code: "ASSIGNMENT_LIMIT_EXCEEDED",
        message: `班次事件超过 ${ROSTER_LIMITS.maxOccurrences} 条，已停止生成。`,
        severity: "error",
        scope: "export",
      });
      break;
    }
    const generated = generateShiftOccurrence(
      assignment,
      person,
      date,
      definition,
      config,
      excludedOccurrenceIds,
    );
    if (generated.occurrence) occurrences.push(generated.occurrence);
    warnings.push(...generated.warnings);
  }
  const withConflicts = detectShiftConflicts(occurrences);
  warnings.push(...withConflicts.flatMap((occurrence) => occurrence.warnings));
  if (!withConflicts.length && selectedPeople.length)
    warnings.push({
      code: "NO_VALID_SHIFT_OCCURRENCES",
      message: "没有可生成的有效班次事件，请检查日期、代码和班次定义。",
      severity: "error",
      scope: "export",
    });
  return { occurrences: withConflicts, warnings };
}

export interface ShiftExportSelection {
  events: EventDraft[];
  warnings: RosterWarning[];
  valid: boolean;
}

export interface ShiftExportOptions {
  mode: "individual" | "team";
  personId?: string;
  includePersonNameInTitle?: boolean;
}

export function selectShiftEventsForExport(
  occurrences: ShiftOccurrence[],
  assignments: ShiftAssignment[],
  people: RosterPerson[],
  options: ShiftExportOptions,
): ShiftExportSelection {
  const warnings: RosterWarning[] = [];
  const selectedPeople = people.filter((person) =>
    options.mode === "individual"
      ? person.id === options.personId && person.selectedForExport
      : person.selectedForExport,
  );
  if (!selectedPeople.length)
    warnings.push({
      code: "NO_PEOPLE_SELECTED",
      message: options.mode === "individual" ? "请选择要导出的人员。" : "请至少选择一个人员。",
      severity: "error",
      scope: "export",
    });
  const selectedIds = new Set(selectedPeople.map((person) => person.id));
  const unresolved = assignments.filter(
    (assignment) =>
      selectedIds.has(assignment.personId) &&
      assignment.normalizedCode &&
      assignment.status !== "mapped" &&
      assignment.status !== "ignored",
  );
  if (unresolved.length)
    warnings.push({
      code: "SHIFT_CODE_UNMAPPED",
      message: `${unresolved.length} 个所选人员的非空 assignment 尚未完成有效映射，导出已阻止。`,
      severity: "error",
      scope: "export",
    });
  const selectedOccurrences = occurrences.filter(
    (occurrence) =>
      selectedIds.has(occurrence.personId) &&
      occurrence.selectedForExport &&
      !occurrence.excludedByUser,
  );
  const invalid = selectedOccurrences.filter(
    (occurrence) => validateEvent(occurrence.event).length,
  );
  if (invalid.length)
    warnings.push({
      code: "SHIFT_OCCURRENCE_INVALID",
      message: `${invalid.length} 个班次事件字段无效，导出已阻止。`,
      severity: "error",
      scope: "export",
    });
  if (!selectedOccurrences.length)
    warnings.push({
      code: "NO_VALID_SHIFT_OCCURRENCES",
      message: "没有可导出的有效班次事件。",
      severity: "error",
      scope: "export",
    });
  const includePerson = options.includePersonNameInTitle ?? options.mode === "team";
  if (options.mode === "team" && !includePerson)
    warnings.push({
      code: "ROSTER_TEAM_TITLE_WITHOUT_PERSON",
      message: "团队事件标题未包含人员姓名，导入日历后可能难以区分。",
      severity: "warning",
      scope: "export",
    });
  const hasErrors = warnings.some((warning) => warning.severity === "error");
  return {
    events: hasErrors
      ? []
      : selectedOccurrences.map((occurrence) => {
          const person = people.find((item) => item.id === occurrence.personId)!;
          return includePerson
            ? {
                ...occurrence.event,
                title: {
                  ...occurrence.event.title,
                  value: `${person.displayName} · ${occurrence.event.title.value}`,
                },
              }
            : occurrence.event;
        }),
    warnings,
    valid: !hasErrors && selectedOccurrences.length > 0,
  };
}

function safeFilenamePart(value: string): string {
  return (
    [...value]
      .filter((character) => character.charCodeAt(0) >= 32)
      .join("")
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "roster"
  );
}

export function createIndividualRosterFilename(person: RosterPerson, config: RosterConfig): string {
  const period =
    config.rosterYear && config.rosterMonth
      ? `${config.rosterYear}-${String(config.rosterMonth).padStart(2, "0")}`
      : "dates";
  return `${safeFilenamePart(person.displayName)}-${period}-排班-Snap2Cal.ics`;
}

export function createTeamRosterFilename(config: RosterConfig, personCount: number): string {
  const period =
    config.rosterYear && config.rosterMonth
      ? `${config.rosterYear}-${String(config.rosterMonth).padStart(2, "0")}`
      : "dates";
  return `Snap2Cal-排班表-${period}-${personCount}人.ics`;
}

export function createRosterSummary(
  occurrences: ShiftOccurrence[],
  people: RosterPerson[],
  includeSkipped = false,
): string {
  void includeSkipped;
  const personMap = new Map(people.map((person) => [person.id, person]));
  return occurrences
    .filter((occurrence) => occurrence.selectedForExport && !occurrence.excludedByUser)
    .sort(
      (first, second) =>
        first.rosterDate.localeCompare(second.rosterDate) ||
        first.personId.localeCompare(second.personId),
    )
    .map((occurrence) => {
      const person = personMap.get(occurrence.personId)?.displayName ?? "未知人员";
      const time = occurrence.event.allDay.value
        ? "全天"
        : `${occurrence.startTime}-${occurrence.endDate !== occurrence.startDate ? "次日" : ""}${occurrence.endTime}`;
      return `${occurrence.rosterDate}｜${person}｜${occurrence.event.title.value}｜${time}`;
    })
    .join("\n");
}
