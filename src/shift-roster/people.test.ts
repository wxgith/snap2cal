import { describe, expect, it } from "vitest";
import { buildRosterPeople } from "./people";
import type { RosterCell, RosterHeaderMapping } from "./types";

function cell(rowIndex: number, text: string): RosterCell {
  return {
    gridCellId: `person-${rowIndex}`,
    rowIndex,
    columnIndex: 0,
    bbox: { x: 0, y: rowIndex * 40, width: 100, height: 40 },
    ocrBlockIds: [],
    confidence: 0.9,
    role: "person-header",
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
  lastPersonRowIndex: 4,
  firstDateColumnIndex: 1,
  lastDateColumnIndex: 3,
  manuallyConfirmed: true,
};

describe("roster people", () => {
  it("preserves internal spaces and stable source-based ids", () => {
    const result = buildRosterPeople([cell(1, " 张 三 "), cell(2, "Alex Chen")], {
      ...mapping,
      lastPersonRowIndex: 2,
    });
    expect(result.people.map((person) => person.displayName)).toEqual(["张 三", "Alex Chen"]);
    expect(result.people[0].id).toContain("person-1");
  });

  it("keeps duplicate people and warns instead of merging", () => {
    const result = buildRosterPeople(
      [cell(1, "张三"), cell(2, "张三"), cell(3, ""), cell(4, "合计")],
      mapping,
    );
    expect(result.people.filter((person) => person.displayName === "张三")).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.code === "ROSTER_DUPLICATE_PERSON_NAME")).toBe(
      true,
    );
    expect(result.warnings.some((warning) => warning.code === "ROSTER_PERSON_NAME_MISSING")).toBe(
      true,
    );
  });
});
