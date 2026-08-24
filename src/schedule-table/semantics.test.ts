import { describe, expect, it } from "vitest";
import { buildOcrDocument } from "../ocr/document";
import { assignOcrBlocksToGridCells } from "./grid";
import { detectScheduleHeaders, parseScheduleWeekday, validateWeekdayMappings } from "./headers";
import { mergeVerticalCourseCells } from "./merge";
import {
  createScheduleTimeSlots,
  parseScheduleTimeHeader,
  validateScheduleTimeSlots,
} from "./timeSlots";
import { createAllWeeksPattern, parseWeekPattern } from "./weekPatterns";
import { buildCourseTemplates, parseCourseCell } from "./courses";
import type { TableGrid } from "./types";

const tableGrid: TableGrid = {
  imageWidth: 640,
  imageHeight: 185,
  horizontalLines: [0, 55, 120, 185].map((position, index) => ({
    id: `h${index}`,
    orientation: "horizontal",
    position,
    confidence: 1,
    origin: "detected",
    locked: false,
  })),
  verticalLines: [0, 100, 280, 460, 640].map((position, index) => ({
    id: `v${index}`,
    orientation: "vertical",
    position,
    confidence: 1,
    origin: "detected",
    locked: false,
  })),
  confidence: 1,
  warnings: [],
};

function fixtureCells() {
  const document = buildOcrDocument(
    {
      blocks: [
        {
          text: "时间",
          confidence: 1,
          bbox: { x: 10, y: 10, width: 50, height: 20 },
          lineIndex: 0,
          orderIndex: 0,
        },
        {
          text: "星期 一",
          confidence: 1,
          bbox: { x: 160, y: 10, width: 70, height: 20 },
          lineIndex: 0,
          orderIndex: 1,
        },
        {
          text: "Monsoon",
          confidence: 1,
          bbox: { x: 350, y: 10, width: 70, height: 20 },
          lineIndex: 0,
          orderIndex: 2,
        },
        {
          text: "周三",
          confidence: 1,
          bbox: { x: 520, y: 10, width: 50, height: 20 },
          lineIndex: 0,
          orderIndex: 3,
        },
        {
          text: "08:00-09:40",
          confidence: 1,
          bbox: { x: 5, y: 75, width: 90, height: 20 },
          lineIndex: 1,
          orderIndex: 4,
        },
        {
          text: "第3-4节",
          confidence: 1,
          bbox: { x: 10, y: 140, width: 70, height: 20 },
          lineIndex: 2,
          orderIndex: 5,
        },
        {
          text: "高等数学\n第一教学楼101\n张老师\n1-4周",
          confidence: 0.9,
          bbox: { x: 125, y: 65, width: 130, height: 45 },
          lineIndex: 3,
          orderIndex: 6,
        },
      ],
    },
    640,
    185,
  );
  return assignOcrBlocksToGridCells(document, tableGrid);
}

describe("课程表语义", () => {
  it("严格识别中英文星期且不猜测相似单词", () => {
    expect(parseScheduleWeekday("星期  一")).toBe("monday");
    expect(parseScheduleWeekday("MONDAY")).toBe("monday");
    expect(parseScheduleWeekday("Monsoon")).toBeNull();
    expect(
      validateWeekdayMappings(
        [
          { columnIndex: 1, weekday: "monday", sourceCellId: "a", manuallyConfirmed: false },
          { columnIndex: 2, weekday: "monday", sourceCellId: "b", manuallyConfirmed: false },
        ],
        4,
      ).map((item) => item.code),
    ).toContain("DUPLICATE_WEEKDAY_MAPPING");
  });

  it("识别表头和直接时间，但不从节次标签编造作息时间", () => {
    const detected = detectScheduleHeaders(fixtureCells());
    expect(detected.mapping.weekdayHeaderRowIndex).toBe(0);
    expect(detected.mapping.timeHeaderColumnIndex).toBe(0);
    expect(detected.mapping.weekdayMappings.map((item) => item.weekday)).toEqual([
      "monday",
      "wednesday",
    ]);
    expect(parseScheduleTimeHeader("上午8点到9点40分")).toMatchObject({
      startTime: "08:00",
      endTime: "09:40",
    });
    expect(parseScheduleTimeHeader("第3-4节")).toMatchObject({
      startTime: null,
      endTime: null,
      isPeriodLabel: true,
    });
    const slots = createScheduleTimeSlots(detected.cells, 0, 0);
    expect(slots[0]).toMatchObject({ startTime: "08:00", endTime: "09:40" });
    expect(validateScheduleTimeSlots(slots).map((item) => item.code)).toContain(
      "TIME_SLOT_MISSING",
    );
  });

  it("规范化范围、列表、单周、双周和默认周次", () => {
    expect(parseWeekPattern("1-6周", 4).pattern.weeks).toEqual([1, 2, 3, 4]);
    expect(parseWeekPattern("1、3、5周", 6).pattern.weeks).toEqual([1, 3, 5]);
    expect(parseWeekPattern("1-3,5-6周", 6).pattern.weeks).toEqual([1, 2, 3, 5, 6]);
    expect(parseWeekPattern("单周", 6).pattern.weeks).toEqual([1, 3, 5]);
    expect(parseWeekPattern("双周", 6).pattern.weeks).toEqual([2, 4, 6]);
    expect(parseWeekPattern("1-6周（单）", 6).pattern.weeks).toEqual([1, 3, 5]);
    const fallback = parseWeekPattern("高等数学", 4, createAllWeeksPattern(4));
    expect(fallback.pattern.weeks).toEqual([1, 2, 3, 4]);
    expect(fallback.pattern.derivedFromDefault).toBe(true);
  });

  it("保守解析课程字段并生成课程模板", () => {
    const detected = detectScheduleHeaders(fixtureCells());
    const slots = createScheduleTimeSlots(detected.cells, 0, 0).map((slot) =>
      slot.rowIndex === 2
        ? { ...slot, startTime: "10:00", endTime: "11:40", manuallyEdited: true }
        : slot,
    );
    const courseCell = detected.cells.find((cell) => cell.role === "course")!;
    const parsed = parseCourseCell(courseCell, 4, createAllWeeksPattern(4));
    expect(parsed.title.value).toBe("高等数学");
    expect(parsed.location.value).toBe("第一教学楼101");
    expect(parsed.teacher.value).toBe("张老师");
    const result = buildCourseTemplates({
      cells: detected.cells,
      weekdayMappings: detected.mapping.weekdayMappings,
      timeSlots: slots,
      totalWeeks: 4,
      defaultWeekPattern: createAllWeeksPattern(4),
    });
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]).toMatchObject({
      weekday: "monday",
      startRowIndex: 1,
      endRowIndex: 1,
    });
  });

  it("解析显式标签和竖线分隔的课程字段", () => {
    const cell = fixtureCells().find((item) => item.rowIndex === 1 && item.columnIndex === 1)!;
    const parsed = parseCourseCell(
      {
        ...cell,
        text: "课程：线性代数｜地点：教一101｜教师：李老师｜周次：1-4周（双）",
      },
      4,
      createAllWeeksPattern(4),
    );
    expect(parsed.title.value).toBe("线性代数");
    expect(parsed.location.value).toBe("教一101");
    expect(parsed.teacher.value).toBe("李老师");
    expect(parsed.weekPattern.weeks).toEqual([2, 4]);
  });

  it("只纵向合并同列连续单元格并可由调用方快照撤销", () => {
    const cells = fixtureCells().filter((cell) => cell.columnIndex === 1 && cell.rowIndex > 0);
    const snapshot = structuredClone(cells);
    const merged = mergeVerticalCourseCells(
      cells,
      cells.map((cell) => cell.id),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ rowSpan: 2, columnSpan: 1, manuallyMerged: true });
    expect(merged[0].sourceCellIds).toHaveLength(2);
    expect(snapshot).toEqual(cells);
  });
});
