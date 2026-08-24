import { describe, expect, it } from "vitest";
import { buildRosterDateColumns, parseRosterDateText } from "./dates";
import type { RosterCell, RosterConfig, RosterHeaderMapping } from "./types";

const config: RosterConfig = {
  rosterYear: 2026,
  rosterMonth: 9,
  timeZone: "Asia/Shanghai",
  exportMode: "team",
  includePersonNameInTitle: true,
  defaultReminderMinutes: null,
};

function cell(rowIndex: number, columnIndex: number, text: string): RosterCell {
  return {
    gridCellId: `cell-${rowIndex}-${columnIndex}`,
    rowIndex,
    columnIndex,
    bbox: { x: columnIndex * 100, y: rowIndex * 50, width: 100, height: 50 },
    ocrBlockIds: [],
    confidence: 0.95,
    role: "unknown",
    originalText: text,
    text,
    manuallyEdited: false,
    warnings: [],
  };
}

const mapping: RosterHeaderMapping = {
  dateHeaderRowIndex: 0,
  weekdayHeaderRowIndex: null,
  personColumnIndex: 0,
  firstPersonRowIndex: 1,
  lastPersonRowIndex: 2,
  firstDateColumnIndex: 1,
  lastDateColumnIndex: 3,
  manuallyConfirmed: true,
};

describe("roster date parsing", () => {
  it.each([
    ["2026-09-01", "2026-09-01"],
    ["2026/9/1", "2026-09-01"],
    ["2026年9月1日", "2026-09-01"],
    ["9月1日", "2026-09-01"],
    ["9/1", "2026-09-01"],
    ["9-1", "2026-09-01"],
    ["09.01", "2026-09-01"],
    ["1", "2026-09-01"],
    ["01", "2026-09-01"],
    ["1日", "2026-09-01"],
  ])("parses %s without current-date inference", (input, expected) => {
    expect(parseRosterDateText(input, config).date).toBe(expected);
  });

  it("requires explicit year and month for incomplete headers", () => {
    expect(
      parseRosterDateText("9月1日", { rosterYear: null, rosterMonth: null }).warnings[0].code,
    ).toBe("ROSTER_YEAR_REQUIRED");
    expect(parseRosterDateText("1", { rosterYear: 2026, rosterMonth: null }).warnings[0].code).toBe(
      "ROSTER_MONTH_REQUIRED",
    );
  });

  it("validates leap days instead of normalizing invalid dates", () => {
    expect(parseRosterDateText("29", { rosterYear: 2024, rosterMonth: 2 }).date).toBe("2024-02-29");
    expect(parseRosterDateText("29", { rosterYear: 2026, rosterMonth: 2 }).warnings[0].code).toBe(
      "ROSTER_DATE_INVALID",
    );
    expect(parseRosterDateText("2026-02-30", config).date).toBeNull();
  });

  it("keeps column order and reports duplicates and descending dates", () => {
    const result = buildRosterDateColumns(
      [cell(0, 1, "3"), cell(0, 2, "2"), cell(0, 3, "2")],
      mapping,
      config,
    );
    expect(result.dateColumns.map((item) => item.date)).toEqual([
      "2026-09-03",
      "2026-09-02",
      "2026-09-02",
    ]);
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ROSTER_DATE_OUT_OF_ORDER", "ROSTER_DATE_DUPLICATE"]),
    );
  });

  it("uses the optional weekday row only for validation", () => {
    const result = buildRosterDateColumns(
      [cell(0, 1, "2026-09-01"), cell(1, 1, "周一")],
      { ...mapping, weekdayHeaderRowIndex: 1, lastDateColumnIndex: 1 },
      config,
    );
    expect(result.dateColumns[0].date).toBe("2026-09-01");
    expect(result.dateColumns[0].weekdayMatchesDate).toBe(false);
    expect(result.warnings.some((item) => item.code === "ROSTER_WEEKDAY_MISMATCH")).toBe(true);
  });
});
