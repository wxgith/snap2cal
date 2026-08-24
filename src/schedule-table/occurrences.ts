import { createField, type EventDraft, type ExtractionWarning } from "../domain/event";
import { validateEvent } from "../domain/validation";
import { addCalendarDays, formatDate, isValidDate, weekdayMondayBased } from "../utils/date";
import type {
  CourseOccurrence,
  CourseTemplate,
  ScheduleConfig,
  ScheduleWarning,
  ScheduleWeekday,
} from "./types";

export const MAX_COURSE_OCCURRENCES = 1000;

const WEEKDAY_OFFSET: Record<ScheduleWeekday, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

function parseDate(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValidDate(result.year, result.month, result.day) ? result : null;
}

export function validateScheduleConfig(config: ScheduleConfig): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const weekOneMonday = parseDate(config.weekOneMonday);
  if (!weekOneMonday || weekdayMondayBased(weekOneMonday) !== 1)
    warnings.push({
      code: "WEEK_ONE_MONDAY_REQUIRED",
      message: "请填写有效的第一教学周星期一日期（YYYY-MM-DD），且该日期必须是星期一。",
      severity: "error",
      scope: "export",
    });
  if (!Number.isInteger(config.totalWeeks) || config.totalWeeks < 1 || config.totalWeeks > 30)
    warnings.push({
      code: "TOTAL_WEEKS_INVALID",
      message: "本学期总周数必须是 1 到 30 之间的整数。",
      severity: "error",
      scope: "export",
    });
  return warnings;
}

function createOccurrenceEvent(
  template: CourseTemplate,
  config: ScheduleConfig,
  weekNumber: number,
  date: string,
  occurrenceId: string,
): EventDraft {
  const details = [
    template.teacher.value ? `教师：${template.teacher.value}` : "",
    template.description.value,
    `教学周：第 ${weekNumber} 周`,
  ]
    .filter(Boolean)
    .join("\n");
  const warnings: ExtractionWarning[] = [
    {
      code: "SCHEDULE_DATE_DERIVED",
      message: "日期由第一教学周星期一、星期列和明确周次推导，请确认。",
      severity: "info",
      relatedField: "startDate",
    },
  ];
  return {
    id: occurrenceId,
    originalText: template.title.source?.text ?? template.title.value,
    title: { ...template.title },
    startDate: createField(date, "high", undefined, true),
    startTime: { ...template.startTime },
    endDate: createField(date, "high", undefined, true),
    endTime: { ...template.endTime },
    location: { ...template.location },
    description: createField(details, "high", template.description.source, true),
    reminderMinutes: createField(config.defaultReminderMinutes, "high", undefined, true),
    allDay: createField(false, "high", undefined, true),
    timeZone: createField(config.timeZone, "high", undefined, true),
    warnings,
    parseContext: {
      referenceDateTime: `${config.weekOneMonday ?? "1970-01-05"}T00:00:00.000Z`,
      timeZone: config.timeZone,
    },
  };
}

function minutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function detectCourseConflicts(occurrences: CourseOccurrence[]): CourseOccurrence[] {
  const conflicts = new Map<string, Set<string>>();
  const active = occurrences.filter(
    (item) => item.selectedForExport && !item.excludedByUser && !validateEvent(item.event).length,
  );
  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    const first = active[firstIndex];
    const firstStart = minutes(first.event.startTime.value);
    const firstEnd = minutes(first.event.endTime.value);
    if (firstStart === null || firstEnd === null) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const second = active[secondIndex];
      if (first.date !== second.date) continue;
      const secondStart = minutes(second.event.startTime.value);
      const secondEnd = minutes(second.event.endTime.value);
      if (secondStart === null || secondEnd === null) continue;
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
    if (!names) return occurrence;
    return {
      ...occurrence,
      warnings: [
        ...occurrence.warnings.filter((item) => item.code !== "COURSE_CONFLICT_DETECTED"),
        {
          code: "COURSE_CONFLICT_DETECTED",
          message: `${occurrence.date} ${occurrence.event.startTime.value}-${occurrence.event.endTime.value} 与 ${[...names].join("、")} 重叠（模板 ${occurrence.templateId}）；冲突仅提示，仍允许用户决定是否导出。`,
          severity: "warning",
          scope: "occurrence",
          targetId: occurrence.id,
        },
      ],
    };
  });
}

export interface OccurrenceGenerationResult {
  occurrences: CourseOccurrence[];
  warnings: ScheduleWarning[];
}

export function generateCourseOccurrences(
  templates: CourseTemplate[],
  config: ScheduleConfig,
  excludedOccurrenceIds: ReadonlySet<string> = new Set(),
): OccurrenceGenerationResult {
  const warnings = validateScheduleConfig(config);
  const monday = parseDate(config.weekOneMonday);
  if (warnings.some((item) => item.severity === "error") || !monday)
    return { occurrences: [], warnings };
  const selectedTemplates = templates.filter((template) => template.selectedForExport);
  if (!selectedTemplates.length)
    warnings.push({
      code: "NO_COURSES_SELECTED",
      message: "请至少选择一门课程。",
      severity: "error",
      scope: "export",
    });
  const occurrences: CourseOccurrence[] = [];
  for (const template of selectedTemplates) {
    if (
      template.warnings.some((item) => item.severity === "error") ||
      !template.title.value.trim() ||
      !template.startTime.value ||
      !template.endTime.value
    )
      continue;
    for (const weekNumber of template.weekPattern.weeks) {
      if (weekNumber < 1 || weekNumber > config.totalWeeks) continue;
      if (occurrences.length >= MAX_COURSE_OCCURRENCES) {
        warnings.push({
          code: "OCCURRENCE_LIMIT_EXCEEDED",
          message: `课程事件超过 ${MAX_COURSE_OCCURRENCES} 条，已停止生成，请缩小周次范围。`,
          severity: "error",
          scope: "export",
        });
        return { occurrences: detectCourseConflicts(occurrences), warnings };
      }
      const date = formatDate(
        addCalendarDays(monday, (weekNumber - 1) * 7 + WEEKDAY_OFFSET[template.weekday]),
      );
      const id = `occurrence:${template.id}:week-${weekNumber}:${date}`;
      const excludedByUser = excludedOccurrenceIds.has(id);
      occurrences.push({
        id,
        templateId: template.id,
        weekNumber,
        date,
        event: createOccurrenceEvent(template, config, weekNumber, date, id),
        selectedForExport: template.selectedForExport,
        excludedByUser,
        warnings: [],
      });
    }
  }
  const withConflicts = detectCourseConflicts(occurrences);
  if (!withConflicts.length)
    warnings.push({
      code: "NO_VALID_OCCURRENCES",
      message: "没有可生成的有效课程事件，请检查课程标题、时间和周次。",
      severity: "error",
      scope: "export",
    });
  return {
    occurrences: withConflicts,
    warnings: [...warnings, ...withConflicts.flatMap((item) => item.warnings)],
  };
}

export interface ScheduleExportSelection {
  events: EventDraft[];
  warnings: ScheduleWarning[];
  valid: boolean;
}

export function selectScheduleEventsForExport(
  occurrences: CourseOccurrence[],
): ScheduleExportSelection {
  const selected = occurrences.filter((item) => item.selectedForExport && !item.excludedByUser);
  const warnings: ScheduleWarning[] = [];
  const invalid = selected.filter((item) => validateEvent(item.event).length > 0);
  if (invalid.length)
    warnings.push({
      code: "NO_VALID_OCCURRENCES",
      message: `${invalid.length} 条已选课程事件字段无效，导出已阻止。`,
      severity: "error",
      scope: "export",
    });
  if (!selected.length)
    warnings.push({
      code: "NO_VALID_OCCURRENCES",
      message: "没有选中可导出的课程事件。",
      severity: "error",
      scope: "export",
    });
  return {
    events: invalid.length ? [] : selected.map((item) => item.event),
    warnings,
    valid: selected.length > 0 && invalid.length === 0,
  };
}
