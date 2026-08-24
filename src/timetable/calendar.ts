import { createField, type EventDraft, type ExtractionWarning } from "../domain/event";
import {
  TIMETABLE_WEEKDAY_LABELS,
  type TimetableCourseCell,
  type TimetableExtractionResult,
  type TimetableWeekRange,
} from "../domain/timetable";
import { addCalendarDays, formatDate, isValidDate } from "../utils/date";

export interface TimetableCalendarOptions {
  semesterStartDate: string;
  weekCount: number;
  timeZone: string;
  selectedCellIds?: string[];
  referenceDateTime?: string;
}

export interface TimetableCalendarResult {
  events: EventDraft[];
  warnings: ExtractionWarning[];
  valid: boolean;
}

function parseDateParts(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValidDate(parts.year, parts.month, parts.day) ? parts : null;
}

function weekRangeLabel(range: TimetableWeekRange, weekCount: number): string {
  const end = range.endWeek ?? weekCount;
  const base =
    range.startWeek === end ? `第 ${range.startWeek} 周` : `第 ${range.startWeek}-${end} 周`;
  if (range.parity === "odd") return `${base}单周`;
  if (range.parity === "even") return `${base}双周`;
  return base;
}

function expandWeeks(
  ranges: TimetableWeekRange[],
  weekCount: number,
): { weeks: number[]; usedDefault: boolean } {
  const effectiveRanges =
    ranges.length > 0
      ? ranges
      : [
          {
            startWeek: 1,
            endWeek: weekCount,
            parity: "all" as const,
            derivedFromDefault: true,
          },
        ];
  const weeks = new Set<number>();
  for (const range of effectiveRanges) {
    const end = Math.min(range.endWeek ?? weekCount, weekCount);
    for (let week = Math.max(1, range.startWeek); week <= end; week += 1) {
      if (range.parity === "odd" && week % 2 === 0) continue;
      if (range.parity === "even" && week % 2 !== 0) continue;
      weeks.add(week);
    }
  }
  return { weeks: [...weeks].sort((a, b) => a - b), usedDefault: ranges.length === 0 };
}

function createTimetableEvent(
  cell: TimetableCourseCell,
  week: number,
  date: string,
  options: TimetableCalendarOptions,
): EventDraft {
  const description = [
    `课程表导入：第 ${week} 周，${TIMETABLE_WEEKDAY_LABELS[cell.weekday]}，${cell.period.label}`,
    cell.weekRanges.length
      ? `识别周次：${cell.weekRanges.map((range) => weekRangeLabel(range, options.weekCount)).join("、")}`
      : "识别周次：未提供，按学期周数推断。",
  ].join("\n");
  const warnings: ExtractionWarning[] = [
    {
      code: "TIMETABLE_DATE_DERIVED",
      message: "课程日期由第 1 周周一日期、星期列和周次推导，请确认学期设置。",
      severity: "info",
      relatedField: "startDate",
    },
    ...cell.warnings,
  ];
  return {
    id: `timetable-${cell.id}-week-${week}`,
    originalText: cell.source.text,
    title: createField(cell.title, cell.confidence, cell.titleSource ?? cell.source),
    startDate: createField(date, "medium", undefined, true),
    startTime: createField(cell.period.startTime, cell.period.confidence, cell.period.source),
    endDate: createField(date, "medium", undefined, true),
    endTime: createField(cell.period.endTime, cell.period.confidence, cell.period.source),
    location: createField(
      cell.location,
      cell.location ? cell.confidence : "low",
      cell.locationSource,
    ),
    description: createField(description, "medium", cell.source, true),
    reminderMinutes: createField<number | null>(null, "high"),
    allDay: createField(false, "high"),
    timeZone: createField(options.timeZone, "high", undefined, true),
    warnings,
    parseContext: {
      referenceDateTime: options.referenceDateTime ?? "1970-01-01T00:00:00.000Z",
      timeZone: options.timeZone,
    },
  };
}

export function buildTimetableCalendar(
  result: TimetableExtractionResult | null,
  options: TimetableCalendarOptions,
): TimetableCalendarResult {
  const warnings: ExtractionWarning[] = [];
  if (!result) {
    warnings.push({
      code: "TIMETABLE_NOT_PARSED",
      message: "请先识别或解析课程表。",
      severity: "error",
    });
    return { events: [], warnings, valid: false };
  }
  warnings.push(...result.warnings);
  const semesterStart = parseDateParts(options.semesterStartDate);
  if (!semesterStart)
    warnings.push({
      code: "TIMETABLE_SEMESTER_START_REQUIRED",
      message: "请填写有效的第 1 周周一日期，格式为 YYYY-MM-DD。",
      severity: "error",
    });
  if (!Number.isInteger(options.weekCount) || options.weekCount < 1 || options.weekCount > 60)
    warnings.push({
      code: "TIMETABLE_WEEK_COUNT_INVALID",
      message: "学期周数必须是 1 到 60 之间的整数。",
      severity: "error",
    });

  const selectedIds = new Set(options.selectedCellIds ?? []);
  const selectedCells = result.cells.filter(
    (cell) => cell.selectedForExport && (!selectedIds.size || selectedIds.has(cell.id)),
  );
  if (selectedCells.length === 0)
    warnings.push({
      code: "TIMETABLE_NO_SELECTED_COURSES",
      message: "请至少选择一个有效课程单元格后再导出。",
      severity: "error",
    });

  const events: EventDraft[] = [];
  for (const cell of selectedCells) {
    if (!cell.title.trim())
      warnings.push({
        code: "TIMETABLE_MISSING_TITLE",
        message: "存在已选择课程缺少课程名称，请补齐后再导出。",
        severity: "error",
      });
    if (!cell.period.startTime || !cell.period.endTime)
      warnings.push({
        code: "TIMETABLE_MISSING_PERIOD_TIME",
        message: `${cell.title || "课程单元格"} 缺少节次起止时间，不能导出日历。`,
        severity: "error",
      });
    const cellHasError =
      cell.warnings.some((warning) => warning.severity === "error") ||
      !cell.title.trim() ||
      !cell.period.startTime ||
      !cell.period.endTime;
    if (cellHasError) {
      warnings.push(
        ...cell.warnings
          .filter((warning) => warning.severity === "error")
          .map((warning) => ({
            ...warning,
            message: `${cell.title || "课程单元格"}：${warning.message}`,
          })),
      );
      continue;
    }
    if (semesterStart) {
      const expanded = expandWeeks(cell.weekRanges, options.weekCount);
      if (expanded.usedDefault)
        warnings.push({
          code: "TIMETABLE_WEEKS_DEFAULTED",
          message: `${cell.title} 未提供周次，已按第 1-${options.weekCount} 周生成，请确认。`,
          severity: "warning",
        });
      if (expanded.weeks.length === 0) {
        warnings.push({
          code: "TIMETABLE_NO_OCCURRENCES",
          message: `${cell.title} 的周次不在当前学期周数内，没有生成事件。`,
          severity: "error",
        });
        continue;
      }
      for (const week of expanded.weeks) {
        const date = formatDate(
          addCalendarDays(semesterStart, (week - 1) * 7 + (cell.weekday - 1)),
        );
        events.push(
          createTimetableEvent(cell, week, date, {
            ...options,
            referenceDateTime: result.parseContext.referenceDateTime,
          }),
        );
      }
    }
  }

  if (events.length > 0)
    warnings.push({
      code: "TIMETABLE_DATES_DERIVED",
      message: `已根据学期设置生成 ${events.length} 个日历事件。`,
      severity: "info",
    });

  return {
    events,
    warnings,
    valid: events.length > 0 && !warnings.some((warning) => warning.severity === "error"),
  };
}
