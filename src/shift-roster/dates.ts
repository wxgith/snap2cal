import { parseScheduleWeekday } from "../schedule-table/headers";
import { formatDate, isValidDate, weekdayMondayBased } from "../utils/date";
import type {
  RosterCell,
  RosterConfig,
  RosterDateColumn,
  RosterHeaderMapping,
  RosterWarning,
} from "./types";
import { ROSTER_LIMITS } from "./types";

interface ParsedRosterDate {
  date: string | null;
  derivedFromYearMonth: boolean;
  warnings: RosterWarning[];
}

function dateWarning(
  code: RosterWarning["code"],
  message: string,
  targetId?: string,
): RosterWarning {
  return { code, message, severity: "error", scope: "date", targetId };
}

function validYear(value: number | null): value is number {
  return Number.isInteger(value) && value !== null && value >= 1 && value <= 9999;
}

function validMonth(value: number | null): value is number {
  return Number.isInteger(value) && value !== null && value >= 1 && value <= 12;
}

function buildDate(
  year: number,
  month: number,
  day: number,
  targetId?: string,
  derivedFromYearMonth = false,
): ParsedRosterDate {
  if (!isValidDate(year, month, day))
    return {
      date: null,
      derivedFromYearMonth,
      warnings: [
        dateWarning(
          "ROSTER_DATE_INVALID",
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 不是有效日期。`,
          targetId,
        ),
      ],
    };
  return { date: formatDate({ year, month, day }), derivedFromYearMonth, warnings: [] };
}

export function parseRosterDateText(
  input: string,
  config: Pick<RosterConfig, "rosterYear" | "rosterMonth">,
  targetId?: string,
): ParsedRosterDate {
  const text = input.trim().normalize("NFKC").replace(/\s+/g, "");
  const full = /^(\d{4})(?:[-/.]|年)(\d{1,2})(?:[-/.]|月)(\d{1,2})日?$/.exec(text);
  if (full) return buildDate(Number(full[1]), Number(full[2]), Number(full[3]), targetId);

  const monthDay = /^(\d{1,2})(?:[-/.]|月)(\d{1,2})日?$/.exec(text);
  if (monthDay) {
    if (!validYear(config.rosterYear))
      return {
        date: null,
        derivedFromYearMonth: true,
        warnings: [
          dateWarning(
            "ROSTER_YEAR_REQUIRED",
            `“${input.trim()}”缺少年份，请填写排班年份。`,
            targetId,
          ),
        ],
      };
    return buildDate(config.rosterYear, Number(monthDay[1]), Number(monthDay[2]), targetId, true);
  }

  const dayOnly = /^(\d{1,2})日?$/.exec(text);
  if (dayOnly) {
    const warnings: RosterWarning[] = [];
    if (!validYear(config.rosterYear))
      warnings.push(
        dateWarning(
          "ROSTER_YEAR_REQUIRED",
          `“${input.trim()}”只有日号，请填写排班年份。`,
          targetId,
        ),
      );
    if (!validMonth(config.rosterMonth))
      warnings.push(
        dateWarning(
          "ROSTER_MONTH_REQUIRED",
          `“${input.trim()}”只有日号，请填写排班月份。`,
          targetId,
        ),
      );
    if (warnings.length || !validYear(config.rosterYear) || !validMonth(config.rosterMonth))
      return { date: null, derivedFromYearMonth: true, warnings };
    return buildDate(config.rosterYear, config.rosterMonth, Number(dayOnly[1]), targetId, true);
  }

  return {
    date: null,
    derivedFromYearMonth: false,
    warnings: [
      dateWarning(
        "ROSTER_DATE_INVALID",
        `无法解析日期标题“${input.trim() || "（空）"}”。`,
        targetId,
      ),
    ],
  };
}

export interface RosterDateMappingResult {
  dateColumns: RosterDateColumn[];
  warnings: RosterWarning[];
}

export function buildRosterDateColumns(
  cells: RosterCell[],
  mapping: RosterHeaderMapping,
  config: RosterConfig,
): RosterDateMappingResult {
  const warnings: RosterWarning[] = [];
  if (
    mapping.dateHeaderRowIndex === null ||
    mapping.firstDateColumnIndex === null ||
    mapping.lastDateColumnIndex === null ||
    mapping.firstDateColumnIndex > mapping.lastDateColumnIndex
  ) {
    warnings.push(
      dateWarning("ROSTER_DATE_HEADER_NOT_FOUND", "请指定日期标题行和有效的日期列范围。"),
    );
    return { dateColumns: [], warnings };
  }
  const count = mapping.lastDateColumnIndex - mapping.firstDateColumnIndex + 1;
  if (count > ROSTER_LIMITS.maxDateColumns) {
    warnings.push(
      dateWarning(
        "ROSTER_DATE_COLUMN_LIMIT_EXCEEDED",
        `日期列不能超过 ${ROSTER_LIMITS.maxDateColumns} 列。`,
      ),
    );
    return { dateColumns: [], warnings };
  }
  const dateColumns: RosterDateColumn[] = [];
  for (
    let columnIndex = mapping.firstDateColumnIndex;
    columnIndex <= mapping.lastDateColumnIndex;
    columnIndex += 1
  ) {
    const source = cells.find(
      (cell) => cell.rowIndex === mapping.dateHeaderRowIndex && cell.columnIndex === columnIndex,
    );
    if (!source) {
      warnings.push(
        dateWarning("ROSTER_DATE_INVALID", `第 ${columnIndex + 1} 列缺少日期标题单元格。`),
      );
      continue;
    }
    const parsed = parseRosterDateText(source.text, config, source.gridCellId);
    const weekdayCell =
      mapping.weekdayHeaderRowIndex === null
        ? undefined
        : cells.find(
            (cell) =>
              cell.rowIndex === mapping.weekdayHeaderRowIndex && cell.columnIndex === columnIndex,
          );
    const parsedWeekday = weekdayCell ? parseScheduleWeekday(weekdayCell.text) : null;
    let weekdayMatchesDate: boolean | undefined;
    const columnWarnings = [...parsed.warnings];
    if (weekdayCell?.text.trim() && parsed.date) {
      const [year, month, day] = parsed.date.split("-").map(Number);
      const weekday = parsedWeekday
        ? ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].indexOf(
            parsedWeekday,
          ) + 1
        : 0;
      weekdayMatchesDate = weekday > 0 && weekdayMondayBased({ year, month, day }) === weekday;
      if (!weekdayMatchesDate)
        columnWarnings.push({
          code: "ROSTER_WEEKDAY_MISMATCH",
          message: `${parsed.date} 与星期文字“${weekdayCell.text.trim()}”不一致，请确认。`,
          severity: "warning",
          scope: "date",
          targetId: weekdayCell.gridCellId,
        });
    }
    const id = `roster-date:${columnIndex}:${source.gridCellId}`;
    dateColumns.push({
      id,
      columnIndex,
      sourceCellId: source.gridCellId,
      originalText: source.originalText,
      date: parsed.date,
      weekdayText: weekdayCell?.text.trim() || undefined,
      weekdayMatchesDate,
      derivedFromYearMonth: parsed.derivedFromYearMonth,
      manuallyEdited: source.manuallyEdited,
      warnings: columnWarnings,
    });
  }
  const seen = new Map<string, RosterDateColumn>();
  let previous: string | null = null;
  for (const column of dateColumns) {
    if (!column.date) continue;
    const duplicate = seen.get(column.date);
    if (duplicate) {
      const warning = dateWarning(
        "ROSTER_DATE_DUPLICATE",
        `${column.date} 被映射到多列，必须修改后才能生成班次。`,
        column.sourceCellId,
      );
      column.warnings.push(warning);
      duplicate.warnings.push({ ...warning, targetId: duplicate.sourceCellId });
    } else seen.set(column.date, column);
    if (previous && column.date <= previous)
      column.warnings.push(
        dateWarning(
          "ROSTER_DATE_OUT_OF_ORDER",
          `${column.date} 没有晚于左侧日期，列顺序不会被静默重排。`,
          column.sourceCellId,
        ),
      );
    previous = column.date;
  }
  warnings.push(...dateColumns.flatMap((column) => column.warnings));
  return { dateColumns, warnings };
}
