import { parseTimes } from "../parser/rules/time";
import type { GridCell, ScheduleTimeSlot, ScheduleWarning } from "./types";

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export interface ParsedTimeHeader {
  label: string;
  startTime: string | null;
  endTime: string | null;
  isPeriodLabel: boolean;
}

export function isValidScheduleTime(value: string | null): boolean {
  if (!value) return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

export function parseScheduleTimeHeader(text: string): ParsedTimeHeader | null {
  const parsed = parseTimes(text);
  if (parsed.start) {
    return {
      label: text.trim(),
      startTime: parsed.start.value,
      endTime: parsed.end?.value ?? null,
      isPeriodLabel: false,
    };
  }
  const normalized = text.trim().replace(/\s+/g, "");
  const period =
    /^(?:第)?([一二三四五六七八九十\d]+)(?:[-—–至]([一二三四五六七八九十\d]+))?节$/.exec(
      normalized,
    );
  if (!period) return null;
  const parseNumber = (value: string) => Number(value) || CHINESE_NUMBERS[value] || null;
  if (!parseNumber(period[1]) || (period[2] && !parseNumber(period[2]))) return null;
  return { label: text.trim(), startTime: null, endTime: null, isPeriodLabel: true };
}

export function createScheduleTimeSlots(
  cells: GridCell[],
  timeHeaderColumnIndex: number | null,
  weekdayHeaderRowIndex: number | null,
): ScheduleTimeSlot[] {
  if (timeHeaderColumnIndex === null) return [];
  return cells
    .filter(
      (cell) =>
        cell.columnIndex === timeHeaderColumnIndex && cell.rowIndex !== weekdayHeaderRowIndex,
    )
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map((cell) => {
      const parsed = parseScheduleTimeHeader(cell.text);
      return {
        rowIndex: cell.rowIndex,
        label: parsed?.label ?? cell.text.trim(),
        startTime: parsed?.startTime ?? null,
        endTime: parsed?.endTime ?? null,
        sourceCellId: cell.id,
        manuallyEdited: false,
      };
    });
}

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function validateScheduleTimeSlots(slots: ScheduleTimeSlot[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const sorted = [...slots].sort((a, b) => a.rowIndex - b.rowIndex);
  let previousEnd: number | null = null;
  for (const slot of sorted) {
    if (!slot.startTime || !slot.endTime) {
      warnings.push({
        code: "TIME_SLOT_MISSING",
        message: `${slot.label || `第 ${slot.rowIndex + 1} 行`}缺少实际开始或结束时间。`,
        severity: "error",
        scope: "cell",
        targetId: slot.sourceCellId,
      });
      previousEnd = null;
      continue;
    }
    if (
      !isValidScheduleTime(slot.startTime) ||
      !isValidScheduleTime(slot.endTime) ||
      minutes(slot.endTime) <= minutes(slot.startTime)
    ) {
      warnings.push({
        code: "TIME_SLOT_INVALID",
        message: `${slot.label || `第 ${slot.rowIndex + 1} 行`}的时间范围无效。`,
        severity: "error",
        scope: "cell",
        targetId: slot.sourceCellId,
      });
      previousEnd = null;
      continue;
    }
    if (previousEnd !== null && minutes(slot.startTime) < previousEnd)
      warnings.push({
        code: "TIME_SLOT_OVERLAP",
        message: `${slot.label || `第 ${slot.rowIndex + 1} 行`}与上一时间段重叠。`,
        severity: "error",
        scope: "cell",
        targetId: slot.sourceCellId,
      });
    previousEnd = minutes(slot.endTime);
  }
  return warnings;
}
