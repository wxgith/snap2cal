import type { EventDraft } from "../domain/event";
import { validateEvent } from "../domain/validation";
import { addCalendarDays, formatDate } from "../utils/date";

export interface GenerateIcsOptions {
  productId?: string;
  now?: Date;
}

export interface BatchEventValidation {
  eventId: string;
  index: number;
  errors: ReturnType<typeof validateEvent>;
}

export interface BatchIcsValidationResult {
  valid: boolean;
  events: BatchEventValidation[];
}

export class BatchIcsValidationError extends Error {
  constructor(public readonly validation: BatchIcsValidationResult) {
    super(
      validation.events
        .flatMap((item) => item.errors.map((error) => `候选 ${item.index + 1}：${error.message}`))
        .join(" ") || "没有可导出的事件。",
    );
    this.name = "BatchIcsValidationError";
  }
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}
function compactTime(date: string, time: string): string {
  return `${compactDate(date)}T${time.replace(":", "")}00`;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return formatDate(addCalendarDays({ year, month, day }, 1));
}

function calendarHeader(options: GenerateIcsOptions): string[] {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.productId ?? "-//Snap2Cal//ZH-CN"}`,
    "CALSCALE:GREGORIAN",
  ];
}

function eventLines(event: EventDraft, now: Date, uidSuffix = ""): string[] {
  const startDate = event.startDate.value!;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.id)}${uidSuffix}@snap2cal.local`,
    `DTSTAMP:${now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")}`,
    `SUMMARY:${escapeText(event.title.value)}`,
  ];
  if (event.allDay.value) {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(startDate)}`);
    const inclusiveEnd = event.endDate.value ?? startDate;
    lines.push(`DTEND;VALUE=DATE:${compactDate(nextDate(inclusiveEnd))}`);
  } else {
    lines.push(
      `DTSTART;TZID=${event.timeZone.value}:${compactTime(startDate, event.startTime.value!)}`,
    );
    if (event.endTime.value) {
      lines.push(
        `DTEND;TZID=${event.timeZone.value}:${compactTime(event.endDate.value ?? startDate, event.endTime.value)}`,
      );
    }
  }
  if (event.location.value) lines.push(`LOCATION:${escapeText(event.location.value)}`);
  if (event.description.value || event.originalText) {
    const description = event.description.value
      ? `${event.description.value}\n\n原文：${event.originalText}`
      : `原文：${event.originalText}`;
    lines.push(`DESCRIPTION:${escapeText(description)}`);
  }
  if (event.reminderMinutes.value !== null) {
    lines.push(
      "BEGIN:VALARM",
      `TRIGGER:-PT${event.reminderMinutes.value}M`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.title.value)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function validateCalendarEvents(events: EventDraft[]): BatchIcsValidationResult {
  const validations = events.map((event, index) => ({
    eventId: event.id,
    index,
    errors: validateEvent(event),
  }));
  return {
    valid: events.length > 0 && validations.every((item) => item.errors.length === 0),
    events: validations,
  };
}

export function generateIcs(event: EventDraft, options: GenerateIcsOptions = {}): string {
  const errors = validateEvent(event);
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
  const lines = [...calendarHeader(options), ...eventLines(event, options.now ?? new Date())];
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function generateCalendarIcs(
  events: EventDraft[],
  options: GenerateIcsOptions = {},
): string {
  const validation = validateCalendarEvents(events);
  if (!validation.valid) throw new BatchIcsValidationError(validation);
  const now = options.now ?? new Date();
  const idCounts = new Map<string, number>();
  const lines = calendarHeader(options);
  for (const event of events) {
    const count = idCounts.get(event.id) ?? 0;
    idCounts.set(event.id, count + 1);
    lines.push(...eventLines(event, now, count ? `-${count + 1}` : ""));
  }
  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function createIcsFilename(event: EventDraft): string {
  const printableTitle = [...event.title.value]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("");
  const safeTitle =
    printableTitle
      .trim()
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "event";
  return `${event.startDate.value ?? "undated"}-${safeTitle}.ics`;
}

export function createCalendarIcsFilename(events: EventDraft[]): string {
  const dates = events
    .map((event) => event.startDate.value)
    .filter((date): date is string => Boolean(date))
    .sort();
  const firstDate = dates[0] ?? "undated";
  return `${firstDate}-${events.length}-events-snap2cal.ics`;
}
