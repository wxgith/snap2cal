import { describe, expect, it } from "vitest";
import { parseEventText } from "../parser";
import {
  createCalendarIcsFilename,
  generateCalendarIcs,
  generateIcs,
  validateCalendarEvents,
} from ".";

const options = {
  referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
};

describe("generateIcs", () => {
  it("生成含中文、时区、提醒、UID 和 CRLF 的日历", () => {
    const event = parseEventText("8月26日下午3点，在万达影城看电影，提前30分钟提醒", options);
    event.description.value = "带卡,水;票\\据\n第二行";
    const ics = generateIcs(event, { now: new Date("2026-08-23T02:00:00Z") });
    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
    expect(ics).toContain("SUMMARY:看电影");
    expect(ics).toContain("DTSTART;TZID=Asia/Shanghai:20260826T150000");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).toMatch(/UID:.+@snap2cal\.local/);
    expect(ics).toContain("带卡\\,水\\;票\\\\据\\n第二行");
    expect(
      ics
        .split("\n")
        .every((line, index, lines) => index === lines.length - 1 || line.endsWith("\r")),
    ).toBe(true);
  });

  it("全天事件使用 DATE 和独占结束日期", () => {
    const event = parseEventText("2026年9月3日全天，新生报到，地点：学校体育馆", options);
    const ics = generateIcs(event);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260903");
    expect(ics).toContain("DTEND;VALUE=DATE:20260904");
  });

  it("无结束时间时不生成 DTEND", () => {
    const event = parseEventText("8月26日下午3点，在万达影城看电影", options);
    expect(generateIcs(event)).not.toContain("DTEND");
  });

  it("缺少必要字段时拒绝生成", () => {
    const event = parseEventText("今天", options);
    expect(() => generateIcs(event)).toThrow("标题");
  });

  it("在单个 VCALENDAR 中生成多个独立 VEVENT", () => {
    const first = parseEventText("8月26日上午9点 项目评审", options);
    const second = parseEventText("8月27日下午2点 客户沟通", options);
    const ics = generateCalendarIcs([first, second], {
      now: new Date("2026-08-23T02:00:00Z"),
    });
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/UID:.+@snap2cal\.local/g)).toHaveLength(2);
    expect(ics).toContain("SUMMARY:项目评审");
    expect(ics).toContain("SUMMARY:客户沟通");
    expect(createCalendarIcsFilename([first, second])).toBe("2026-08-26-2-events-snap2cal.ics");
  });

  it("批量导出不会静默跳过无效事件", () => {
    const valid = parseEventText("8月26日上午9点 项目评审", options);
    const invalid = parseEventText("今天", options);
    expect(validateCalendarEvents([valid, invalid])).toEqual(
      expect.objectContaining({ valid: false }),
    );
    expect(() => generateCalendarIcs([valid, invalid])).toThrow("候选 2");
    expect(() => generateCalendarIcs([])).toThrow("没有可导出");
  });
});
