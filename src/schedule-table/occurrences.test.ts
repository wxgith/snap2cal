import { describe, expect, it } from "vitest";
import { createField } from "../domain/event";
import {
  detectCourseConflicts,
  generateCourseOccurrences,
  selectScheduleEventsForExport,
  validateScheduleConfig,
} from "./occurrences";
import { createAllWeeksPattern, parseWeekPattern } from "./weekPatterns";
import type { CourseTemplate, ScheduleConfig } from "./types";

function config(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    weekOneMonday: "2026-09-07",
    totalWeeks: 4,
    timeZone: "Asia/Shanghai",
    defaultReminderMinutes: 15,
    defaultWeekPattern: createAllWeeksPattern(4),
    ...overrides,
  };
}

function template(
  id: string,
  weekday: CourseTemplate["weekday"],
  startTime: string,
  endTime: string,
  weeks = [1, 2, 3, 4],
): CourseTemplate {
  return {
    id,
    sourceCellIds: [id],
    weekday,
    startRowIndex: 1,
    endRowIndex: 1,
    title: createField(id, "high"),
    location: createField("A101", "high"),
    teacher: createField("张老师", "high"),
    description: createField("", "high"),
    startTime: createField(startTime, "high"),
    endTime: createField(endTime, "high"),
    weekPattern: {
      kind: "explicit",
      weeks,
      originalExpression: `${weeks.join("、")}周`,
      derivedFromDefault: false,
      manuallyEdited: false,
    },
    selectedForExport: true,
    manuallyConfirmed: true,
    manuallyEdited: false,
    warnings: [],
  };
}

describe("CourseOccurrence", () => {
  it("只由第一教学周星期一、周次和 weekday offset 计算跨月跨年日期", () => {
    const result = generateCourseOccurrences(
      [
        template("周一课", "monday", "08:00", "09:40", [1, 2]),
        template("周日课", "sunday", "10:00", "11:40", [1]),
      ],
      config({ weekOneMonday: "2026-12-28" }),
    );
    expect(result.occurrences.map((item) => item.date)).toEqual([
      "2026-12-28",
      "2027-01-04",
      "2027-01-03",
    ]);
    expect(result.occurrences[0].id).toContain("2026-12-28");
    expect(result.occurrences[0].event.reminderMinutes.value).toBe(15);
  });

  it("单周和双周按教学周编号展开", () => {
    const odd = template("单周课", "monday", "08:00", "09:00");
    odd.weekPattern = parseWeekPattern("单周", 6).pattern;
    const even = template("双周课", "tuesday", "08:00", "09:00");
    even.weekPattern = parseWeekPattern("双周", 6).pattern;
    const result = generateCourseOccurrences([odd, even], config({ totalWeeks: 6 }));
    expect(
      result.occurrences
        .filter((item) => item.templateId === odd.id)
        .map((item) => item.weekNumber),
    ).toEqual([1, 3, 5]);
    expect(
      result.occurrences
        .filter((item) => item.templateId === even.id)
        .map((item) => item.weekNumber),
    ).toEqual([2, 4, 6]);
  });

  it("排除具体 occurrence 不删除模板，ID 对相同输入稳定", () => {
    const first = generateCourseOccurrences(
      [template("高数", "monday", "08:00", "09:40")],
      config(),
    );
    const excluded = new Set([first.occurrences[2].id]);
    const second = generateCourseOccurrences(
      [template("高数", "monday", "08:00", "09:40")],
      config(),
      excluded,
    );
    expect(second.occurrences.map((item) => item.id)).toEqual(
      first.occurrences.map((item) => item.id),
    );
    expect(second.occurrences[2].excludedByUser).toBe(true);
    expect(selectScheduleEventsForExport(second.occurrences).events).toHaveLength(3);
  });

  it("检测同日重叠并只警告，不自动删除", () => {
    const first = generateCourseOccurrences(
      [
        template("课程 A", "monday", "08:00", "10:00", [1]),
        template("课程 B", "monday", "09:30", "11:00", [1]),
      ],
      config(),
    );
    const conflicts = detectCourseConflicts(first.occurrences);
    expect(conflicts).toHaveLength(2);
    expect(
      conflicts.every((item) =>
        item.warnings.some((warning) => warning.code === "COURSE_CONFLICT_DETECTED"),
      ),
    ).toBe(true);
    expect(selectScheduleEventsForExport(conflicts).events).toHaveLength(2);
  });

  it("要求有效且确实为星期一的日期和合理总周数", () => {
    expect(
      validateScheduleConfig(config({ weekOneMonday: "2026-09-08", totalWeeks: 0 })).map(
        (item) => item.code,
      ),
    ).toEqual(expect.arrayContaining(["WEEK_ONE_MONDAY_REQUIRED", "TOTAL_WEEKS_INVALID"]));
  });
});
