import { describe, expect, it } from "vitest";
import { buildOcrDocument } from "../ocr/document";
import type { OcrRawResult } from "../ocr/types";
import { buildTimetableCalendar } from "./calendar";
import { parseTimetableFromOcrDocument } from "./ocrGeometry";
import { parseTimetableText } from "./parser";

const options = {
  referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
};

describe("课程表解析", () => {
  it("从二维文本表格识别星期列、节次行和课程单元格", () => {
    const input = [
      "| 周一 | 周二 | 周三 |",
      "1-2节 08:00-09:40 | 高等数学@A101[1-2周] | 英语@B202[单周] |",
      "3-4节 10:00-11:40 | | 程序设计@机房[2周] |",
    ].join("\n");
    const result = parseTimetableText(input, options);
    expect(result.warnings).toEqual([]);
    expect(result.cells).toHaveLength(3);
    expect(result.cells[0]).toMatchObject({
      title: "高等数学",
      location: "A101",
      weekday: 1,
      selectedForExport: true,
    });
    expect(result.cells[0].source.startIndex).toBe(input.indexOf("高等数学"));
    expect(result.cells[1].weekRanges[0]).toMatchObject({ parity: "odd", startWeek: 1 });
    expect(result.cells[2].period).toMatchObject({ startTime: "10:00", endTime: "11:40" });
  });

  it("用 OCR 几何位置而不是阅读顺序归并课程表单元格", () => {
    const raw: OcrRawResult = {
      blocks: [
        {
          text: "周二",
          confidence: 0.95,
          bbox: { x: 220, y: 20, width: 60, height: 24 },
          lineIndex: 0,
          orderIndex: 0,
        },
        {
          text: "周一",
          confidence: 0.96,
          bbox: { x: 120, y: 20, width: 60, height: 24 },
          lineIndex: 0,
          orderIndex: 1,
        },
        {
          text: "1-2节 08:00-09:40",
          confidence: 0.94,
          bbox: { x: 10, y: 82, width: 90, height: 24 },
          lineIndex: 1,
          orderIndex: 2,
        },
        {
          text: "英语@B202[1周]",
          confidence: 0.92,
          bbox: { x: 222, y: 82, width: 88, height: 24 },
          lineIndex: 1,
          orderIndex: 3,
        },
        {
          text: "高等数学@A101[1周]",
          confidence: 0.91,
          bbox: { x: 122, y: 82, width: 110, height: 24 },
          lineIndex: 1,
          orderIndex: 4,
        },
      ],
    };
    const document = buildOcrDocument(raw, 360, 180);
    const result = parseTimetableFromOcrDocument(document, options);
    expect(result.warnings).toEqual([]);
    expect(result.cells.map((cell) => `${cell.weekday}:${cell.title}`)).toEqual([
      "1:高等数学",
      "2:英语",
    ]);
    expect(result.cells[0].evidenceBlockIds).toHaveLength(1);
    expect(result.cells[0].source.text).toContain("高等数学");
  });

  it("按第 1 周周一日期和周次展开为多个 EventDraft", () => {
    const input = "| 周一 | 周二 |\n1-2节 08:00-09:40 | 高等数学@A101[1-2周] | 英语@B202[单周] |";
    const result = parseTimetableText(input, options);
    const calendar = buildTimetableCalendar(result, {
      semesterStartDate: "2026-09-07",
      weekCount: 2,
      timeZone: "Asia/Shanghai",
    });
    expect(calendar.valid).toBe(true);
    expect(calendar.events).toHaveLength(3);
    expect(calendar.events.map((event) => `${event.title.value}:${event.startDate.value}`)).toEqual(
      ["高等数学:2026-09-07", "高等数学:2026-09-14", "英语:2026-09-08"],
    );
    expect(
      calendar.events[0].warnings.some((warning) => warning.code === "TIMETABLE_DATE_DERIVED"),
    ).toBe(true);
  });

  it("缺少学期日期或节次时间时给出可见错误", () => {
    const input = "| 周一 | 周二 |\n1-2节 | 高等数学@A101[1周] |";
    const result = parseTimetableText(input, options);
    result.cells[0].selectedForExport = true;
    const calendar = buildTimetableCalendar(result, {
      semesterStartDate: "",
      weekCount: 16,
      timeZone: "Asia/Shanghai",
    });
    expect(calendar.valid).toBe(false);
    expect(calendar.warnings.map((warning) => warning.code)).toContain(
      "TIMETABLE_SEMESTER_START_REQUIRED",
    );
    expect(calendar.warnings.map((warning) => warning.code)).toContain(
      "TIMETABLE_MISSING_PERIOD_TIME",
    );
  });
});
