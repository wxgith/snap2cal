import { describe, expect, it } from "vitest";
import { buildShiftAssignments, buildShiftCodeCatalog } from "./assignments";
import { createShiftDefinition } from "./shifts";
import type { RosterCell, RosterDateColumn, RosterPerson, ShiftDefinition } from "./types";

const person: RosterPerson = {
  id: "person-1",
  rowIndex: 1,
  sourceCellId: "person-cell",
  originalText: "张三",
  displayName: "张三",
  selectedForExport: true,
  manuallyEdited: false,
  warnings: [],
};

function date(columnIndex: number, value: string): RosterDateColumn {
  return {
    id: `date-${columnIndex}`,
    columnIndex,
    sourceCellId: `date-cell-${columnIndex}`,
    originalText: value,
    date: value,
    derivedFromYearMonth: false,
    manuallyEdited: false,
    warnings: [],
  };
}

function cell(columnIndex: number, text: string, confidence = 0.95): RosterCell {
  return {
    gridCellId: `assignment-cell-${columnIndex}`,
    rowIndex: 1,
    columnIndex,
    bbox: { x: columnIndex * 100, y: 50, width: 100, height: 50 },
    ocrBlockIds: [`block-${columnIndex}`],
    confidence,
    role: "assignment",
    originalText: text,
    text,
    manuallyEdited: false,
    warnings: [],
  };
}

function definition(code: string, patch: Partial<ShiftDefinition> = {}): ShiftDefinition {
  return {
    ...createShiftDefinition(code),
    id: `definition-${code}`,
    displayName: code,
    startTime: "08:00",
    endTime: "16:00",
    manuallyConfirmed: true,
    ...patch,
  };
}

describe("shift assignments", () => {
  it("maps aliases exactly and keeps non-empty symbols unmapped", () => {
    const dates = [date(1, "2026-09-01"), date(2, "2026-09-02"), date(3, "2026-09-03")];
    const result = buildShiftAssignments(
      [cell(1, " a "), cell(2, "-"), cell(3, "")],
      [person],
      dates,
      [definition("A", { aliases: ["早"] })],
    );
    expect(result.assignments.map((item) => item.status)).toEqual(["mapped", "unmapped", "empty"]);
    expect(result.assignments[0].normalizedCode).toBe("A");
    expect(result.assignments[1].normalizedCode).toBe("-");
  });

  it("does not split multiple codes and requires low-confidence review", () => {
    const result = buildShiftAssignments(
      [cell(1, "A/N"), cell(2, "A", 0.4)],
      [person],
      [date(1, "2026-09-01"), date(2, "2026-09-02")],
      [definition("A"), definition("N")],
    );
    expect(result.assignments[0].warnings[0].code).toBe("SHIFT_MULTIPLE_CODES_UNSUPPORTED");
    expect(result.assignments[1].status).toBe("needs-review");
    expect(
      result.assignments[1].warnings.some((item) => item.code === "ASSIGNMENT_LOW_OCR_CONFIDENCE"),
    ).toBe(true);
  });

  it("builds a deterministic catalog without text-search positioning", () => {
    const dates = [date(1, "2026-09-01"), date(2, "2026-09-02")];
    const cells = [cell(1, "A"), cell(2, "Ａ")];
    const result = buildShiftAssignments(cells, [person], dates, [definition("A")]);
    const catalog = buildShiftCodeCatalog(result.assignments, cells, [person], dates);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      normalizedCode: "A",
      occurrenceCount: 2,
      personCount: 1,
      exampleCellId: "assignment-cell-1",
    });
  });

  it("preserves original text when a cell code is manually edited", () => {
    const edited = { ...cell(1, "N"), originalText: "A", manuallyEdited: true };
    const result = buildShiftAssignments(
      [edited],
      [person],
      [date(1, "2026-09-01")],
      [definition("N")],
    );
    expect(result.assignments[0]).toMatchObject({
      originalText: "A",
      normalizedCode: "N",
      manuallyEdited: true,
      status: "mapped",
    });
  });
});
