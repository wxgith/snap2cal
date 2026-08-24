import { createField, makeSource, type EventDraft, type ExtractionWarning } from "../domain/event";
import { parseDates } from "./rules/date";
import { ALL_DAY_PATTERN } from "./rules/patterns";
import { parseReminder } from "./rules/reminder";
import { parseTextFields } from "./rules/text";
import { parseTimes } from "./rules/time";
import type { ParseEventTextOptions, RuleMatch } from "./types";

function fieldFromMatch<T>(match: RuleMatch<T> | undefined, fallback: T) {
  return match
    ? createField(match.value, match.confidence, match.source, match.derivedFromDefault ?? false)
    : createField(fallback);
}

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `event-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function parseEventText(input: string, options: ParseEventTextOptions): EventDraft {
  const normalized = input.trim();
  const warnings: ExtractionWarning[] = [];
  const dateResult = parseDates(normalized, options);
  const timeResult = parseTimes(normalized);
  const reminder = parseReminder(normalized);
  const allDayMatch = new RegExp(ALL_DAY_PATTERN.source, ALL_DAY_PATTERN.flags).exec(normalized);
  const consumed: Array<[number, number]> = [];
  for (const item of dateResult.candidates)
    consumed.push([item.source.startIndex, item.source.endIndex]);
  if (timeResult.start)
    consumed.push([timeResult.start.source.startIndex, timeResult.start.source.endIndex]);
  if (timeResult.end)
    consumed.push([timeResult.end.source.startIndex, timeResult.end.source.endIndex]);
  if (reminder) consumed.push([reminder.source.startIndex, reminder.source.endIndex]);
  if (allDayMatch) consumed.push([allDayMatch.index, allDayMatch.index + allDayMatch[0].length]);
  const text = parseTextFields(normalized, consumed);

  warnings.push(...dateResult.warnings, ...timeResult.warnings);
  if (!normalized)
    warnings.push({ code: "EMPTY_INPUT", message: "请输入或粘贴活动文本。", severity: "error" });
  if (!dateResult.selected)
    warnings.push({
      code: "MISSING_DATE",
      message: "未识别到活动日期，请手工填写。",
      severity: "error",
      relatedField: "startDate",
    });
  if (!text.title)
    warnings.push({
      code: "MISSING_TITLE",
      message: "未能可靠识别事件标题，请手工填写。",
      severity: "error",
      relatedField: "title",
    });
  if (!allDayMatch && !timeResult.start)
    warnings.push({
      code: "MISSING_TIME",
      message: "未识别到开始时间；如非全天事件，请手工填写。",
      severity: "warning",
      relatedField: "startTime",
    });
  if (
    dateResult.selected &&
    dateResult.selected.value <
      (() => {
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: options.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        return formatter.format(options.referenceDateTime);
      })() &&
    !warnings.some((warning) => warning.code === "PAST_DATE")
  ) {
    warnings.push({
      code: "PAST_DATE",
      message: "识别出的日期已经过去，请确认。",
      severity: "warning",
      relatedField: "startDate",
    });
  }

  const startDate = fieldFromMatch(dateResult.selected, null as string | null);
  const startTime = allDayMatch
    ? createField<string | null>(null, "high")
    : fieldFromMatch(timeResult.start, null as string | null);
  const endDate =
    timeResult.end && dateResult.selected
      ? createField<string | null>(
          dateResult.selected.value,
          "medium",
          dateResult.selected.source,
          true,
        )
      : createField<string | null>(null);
  const endTime = allDayMatch
    ? createField<string | null>(null, "high")
    : fieldFromMatch(timeResult.end, null as string | null);

  return {
    id: createId(),
    originalText: normalized,
    title: fieldFromMatch(text.title, ""),
    startDate,
    startTime,
    endDate,
    endTime,
    location: fieldFromMatch(text.location, ""),
    description: fieldFromMatch(text.description, ""),
    reminderMinutes: fieldFromMatch(reminder, null as number | null),
    allDay: allDayMatch
      ? createField(true, "high", makeSource(normalized, allDayMatch.index, allDayMatch[0]))
      : createField(false, "high"),
    timeZone: createField(options.timeZone, "high", undefined, true),
    warnings,
    parseContext: {
      referenceDateTime: options.referenceDateTime.toISOString(),
      timeZone: options.timeZone,
    },
  };
}

export type { ParseEventTextOptions } from "./types";
