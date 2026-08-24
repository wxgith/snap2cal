import { createField, type ExtractedField, type SourceSpan } from "../domain/event";
import { parseWeekPattern } from "./weekPatterns";
import type {
  CourseTemplate,
  GridCell,
  ScheduleTimeSlot,
  ScheduleWarning,
  WeekPattern,
  WeekdayColumnMapping,
} from "./types";

interface TextPart {
  text: string;
  startIndex: number;
  endIndex: number;
}

function linesWithOffsets(text: string): TextPart[] {
  const result: TextPart[] = [];
  const pattern = /[^\r\n|｜]+/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const leftTrim = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (!value || match.index === undefined) continue;
    result.push({
      text: value,
      startIndex: match.index + leftTrim,
      endIndex: match.index + leftTrim + value.length,
    });
  }
  return result;
}

function source(part: TextPart): SourceSpan {
  return { text: part.text, startIndex: part.startIndex, endIndex: part.endIndex };
}

function field<T>(value: T, part?: TextPart, confidence: "high" | "medium" | "low" = "low") {
  return createField(value, confidence, part ? source(part) : undefined);
}

function removeWeekExpressions(value: string): string {
  return value
    .replace(/(?:第\s*)?\d{1,2}(?:\s*[-—–~至]\s*\d{1,2})?\s*周/g, "")
    .replace(/(?:\d{1,2}\s*[,，、]\s*)+\d{1,2}\s*周/g, "")
    .replace(/(?:每周|全周|单周|双周)/g, "")
    .replace(/[（(]\s*[单双]\s*[)）]/g, "")
    .replace(/\[|\]|【|】|\(|\)|（|）/g, "")
    .trim();
}

interface ParsedCourseFields {
  title: ExtractedField<string>;
  location: ExtractedField<string>;
  teacher: ExtractedField<string>;
  description: ExtractedField<string>;
  weekPattern: WeekPattern;
  warnings: ScheduleWarning[];
}

export function parseCourseCell(
  cell: GridCell,
  totalWeeks: number,
  defaultWeekPattern: WeekPattern,
): ParsedCourseFields {
  const warnings: ScheduleWarning[] = [];
  const weekResult = parseWeekPattern(cell.text, totalWeeks, defaultWeekPattern);
  warnings.push(...weekResult.warnings.map((item) => ({ ...item, targetId: cell.id })));
  const lines = linesWithOffsets(cell.text)
    .map((part) => ({ ...part, text: removeWeekExpressions(part.text) }))
    .filter((part) => part.text);
  let titlePart: TextPart | undefined;
  let locationPart: TextPart | undefined;
  let teacherPart: TextPart | undefined;
  const remaining: TextPart[] = [];

  for (const part of lines) {
    const titleLabel = /^(?:课程|名称|课程名称)\s*[:：]\s*(.+)$/.exec(part.text);
    const locationLabel = /^(?:地点|教室|地址)\s*[:：]\s*(.+)$/.exec(part.text);
    const atLocation = /^(.*?)\s*@\s*(.+)$/.exec(part.text);
    const teacherLabel = /^(?:教师|老师|授课教师)\s*[:：]\s*(.+)$/.exec(part.text);
    if (/^周次\s*[:：]?$/.test(part.text)) continue;
    if (titleLabel && !titlePart) {
      const offset = part.text.indexOf(titleLabel[1]);
      titlePart = {
        text: titleLabel[1].trim(),
        startIndex: part.startIndex + offset,
        endIndex: part.startIndex + offset + titleLabel[1].trim().length,
      };
      continue;
    }
    if (locationLabel && !locationPart) {
      const offset = part.text.indexOf(locationLabel[1]);
      locationPart = {
        text: locationLabel[1].trim(),
        startIndex: part.startIndex + offset,
        endIndex: part.startIndex + offset + locationLabel[1].trim().length,
      };
      continue;
    }
    if (atLocation && !locationPart) {
      if (atLocation[1].trim() && !titlePart)
        titlePart = {
          text: atLocation[1].trim(),
          startIndex: part.startIndex,
          endIndex: part.startIndex + atLocation[1].trim().length,
        };
      const offset = part.text.lastIndexOf(atLocation[2]);
      locationPart = {
        text: atLocation[2].trim(),
        startIndex: part.startIndex + offset,
        endIndex: part.startIndex + offset + atLocation[2].trim().length,
      };
      continue;
    }
    if (teacherLabel && !teacherPart) {
      const offset = part.text.indexOf(teacherLabel[1]);
      teacherPart = {
        text: teacherLabel[1].trim(),
        startIndex: part.startIndex + offset,
        endIndex: part.startIndex + offset + teacherLabel[1].trim().length,
      };
      continue;
    }
    if (!teacherPart && /(?:老师|教师)$/.test(part.text)) {
      teacherPart = part;
      continue;
    }
    if (
      !locationPart &&
      /(?:教学楼|实验楼|实验室|教室|体育馆|图书馆|校区|楼|室)\s*[A-Za-z]?\d+|教[一二三四五六七八九十A-Za-z]*\d+|^[A-Za-z]\d{2,4}$/i.test(
        part.text,
      )
    ) {
      locationPart = part;
      warnings.push({
        code: "COURSE_LOCATION_UNCERTAIN",
        message: `“${part.text}”按版式推断为地点，请确认。`,
        severity: "warning",
        scope: "template",
        targetId: cell.id,
      });
      continue;
    }
    if (!titlePart) titlePart = part;
    else remaining.push(part);
  }

  if (!titlePart)
    warnings.push({
      code: "COURSE_TITLE_MISSING",
      message: "课程单元格缺少可识别的课程名称。",
      severity: "error",
      scope: "template",
      targetId: cell.id,
    });
  if (!locationPart)
    warnings.push({
      code: "COURSE_LOCATION_UNCERTAIN",
      message: "课程没有明确地点，将保持为空。",
      severity: "info",
      scope: "template",
      targetId: cell.id,
    });
  if (!teacherPart)
    warnings.push({
      code: "COURSE_TEACHER_UNCERTAIN",
      message: "课程没有明确教师，将保持为空。",
      severity: "info",
      scope: "template",
      targetId: cell.id,
    });
  return {
    title: field(titlePart?.text ?? "", titlePart, titlePart ? "high" : "low"),
    location: field(locationPart?.text ?? "", locationPart, locationPart ? "medium" : "low"),
    teacher: field(teacherPart?.text ?? "", teacherPart, teacherPart ? "medium" : "low"),
    description: field(
      remaining.map((part) => part.text).join("\n"),
      remaining[0],
      remaining.length ? "medium" : "high",
    ),
    weekPattern: weekResult.pattern,
    warnings,
  };
}

export interface BuildCourseTemplatesOptions {
  cells: GridCell[];
  weekdayMappings: WeekdayColumnMapping[];
  timeSlots: ScheduleTimeSlot[];
  totalWeeks: number;
  defaultWeekPattern: WeekPattern;
}

export interface CourseTemplateBuildResult {
  templates: CourseTemplate[];
  warnings: ScheduleWarning[];
}

export const MAX_COURSE_TEMPLATES = 100;

function titleSummary(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildCourseTemplates(
  options: BuildCourseTemplatesOptions,
): CourseTemplateBuildResult {
  const templates: CourseTemplate[] = [];
  const warnings: ScheduleWarning[] = [];
  const weekdayByColumn = new Map(
    options.weekdayMappings.map((mapping) => [mapping.columnIndex, mapping.weekday]),
  );
  const slots = new Map(options.timeSlots.map((slot) => [slot.rowIndex, slot]));
  for (const cell of options.cells) {
    if (cell.role !== "course") continue;
    if (templates.length >= MAX_COURSE_TEMPLATES) {
      warnings.push({
        code: "OCCURRENCE_LIMIT_EXCEEDED",
        message: `课程模板超过 ${MAX_COURSE_TEMPLATES} 个，已停止生成，请检查网格和课程格。`,
        severity: "error",
        scope: "export",
      });
      break;
    }
    if (cell.columnSpan !== 1) {
      warnings.push({
        code: "COURSE_HORIZONTAL_SPAN_UNSUPPORTED",
        message: "首版不支持横跨多个星期列的课程。",
        severity: "error",
        scope: "cell",
        targetId: cell.id,
      });
      continue;
    }
    if (!cell.text.trim()) {
      warnings.push({
        code: "COURSE_CELL_EMPTY",
        message: "已标记为课程的单元格没有文字。",
        severity: "warning",
        scope: "cell",
        targetId: cell.id,
      });
      continue;
    }
    const weekday = weekdayByColumn.get(cell.columnIndex);
    if (!weekday) {
      warnings.push({
        code: "WEEKDAY_HEADER_NOT_FOUND",
        message: "课程所在列没有星期映射。",
        severity: "error",
        scope: "cell",
        targetId: cell.id,
      });
      continue;
    }
    const startRowIndex = cell.rowIndex;
    const endRowIndex = cell.rowIndex + cell.rowSpan - 1;
    const startSlot = slots.get(startRowIndex);
    const endSlot = slots.get(endRowIndex);
    const parsed = parseCourseCell(cell, options.totalWeeks, options.defaultWeekPattern);
    const templateWarnings = [...cell.warnings, ...parsed.warnings];
    if (!startSlot?.startTime || !endSlot?.endTime)
      templateWarnings.push({
        code: "TIME_SLOT_MISSING",
        message: "课程覆盖的时间行缺少实际开始或结束时间。",
        severity: "error",
        scope: "template",
        targetId: cell.id,
      });
    const id = `course:${cell.id}:${weekday}:${startRowIndex}-${endRowIndex}:${titleSummary(parsed.title.value)}`;
    templates.push({
      id,
      sourceCellIds: cell.sourceCellIds,
      weekday,
      startRowIndex,
      endRowIndex,
      ...parsed,
      startTime: createField(startSlot?.startTime ?? null, startSlot?.startTime ? "high" : "low"),
      endTime: createField(endSlot?.endTime ?? null, endSlot?.endTime ? "high" : "low"),
      selectedForExport: true,
      manuallyConfirmed: true,
      manuallyEdited: false,
      warnings: templateWarnings,
    });
  }
  warnings.push(...templates.flatMap((template) => template.warnings));
  return { templates, warnings };
}
