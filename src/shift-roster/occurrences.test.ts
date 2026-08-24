import { describe, expect, it } from "vitest";
import {
  detectShiftConflicts,
  generateShiftOccurrence,
  generateShiftOccurrences,
  selectShiftEventsForExport,
} from "./occurrences";
import { createShiftDefinition } from "./shifts";
import type {
  RosterConfig,
  RosterDateColumn,
  RosterPerson,
  ShiftAssignment,
  ShiftDefinition,
  ShiftOccurrence,
} from "./types";

const config: RosterConfig = {
  rosterYear: 2026,
  rosterMonth: 9,
  timeZone: "Asia/Shanghai",
  exportMode: "team",
  includePersonNameInTitle: true,
  defaultReminderMinutes: 15,
};

function person(id = "person-1", name = "张三"): RosterPerson {
  return {
    id,
    rowIndex: Number(id.at(-1)) || 1,
    sourceCellId: `${id}-cell`,
    originalText: name,
    displayName: name,
    selectedForExport: true,
    manuallyEdited: false,
    warnings: [],
  };
}

function date(value: string, index = 1): RosterDateColumn {
  return {
    id: `date-${index}`,
    columnIndex: index,
    sourceCellId: `date-cell-${index}`,
    originalText: value,
    date: value,
    derivedFromYearMonth: false,
    manuallyEdited: false,
    warnings: [],
  };
}

function assignment(
  personId = "person-1",
  dateColumnId = "date-1",
  definitionId = "day",
): ShiftAssignment {
  return {
    id: `assignment-${personId}-${dateColumnId}`,
    personId,
    dateColumnId,
    sourceCellId: `cell-${personId}-${dateColumnId}`,
    originalText: definitionId === "night" ? "N" : "A",
    normalizedCode: definitionId === "night" ? "N" : "A",
    shiftDefinitionId: definitionId,
    status: "mapped",
    selectedForExport: true,
    manuallyEdited: false,
    warnings: [],
  };
}

function definition(id = "day", patch: Partial<ShiftDefinition> = {}): ShiftDefinition {
  return {
    ...createShiftDefinition(id === "night" ? "N" : "A"),
    id,
    displayName: id === "night" ? "夜班" : "早班",
    startTime: id === "night" ? "20:00" : "08:00",
    endTime: id === "night" ? "08:00" : "16:00",
    crossesMidnight: id === "night",
    manuallyConfirmed: true,
    ...patch,
  };
}

function generatedOccurrence(
  rosterDate: string,
  shift: ShiftDefinition,
  personValue = person(),
  assignmentValue = assignment(personValue.id, "date-1", shift.id),
): ShiftOccurrence {
  const result = generateShiftOccurrence(
    assignmentValue,
    personValue,
    date(rosterDate),
    shift,
    config,
  );
  expect(result.warnings).toHaveLength(0);
  return result.occurrence!;
}

describe("shift occurrences", () => {
  it("generates same-day and cross-midnight dates deterministically", () => {
    expect(generatedOccurrence("2026-09-01", definition()).endDate).toBe("2026-09-01");
    const night = generatedOccurrence("2026-09-01", definition("night"));
    expect(night).toMatchObject({
      rosterDate: "2026-09-01",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      startTime: "20:00",
      endTime: "08:00",
    });
    expect(generatedOccurrence("2026-12-31", definition("night")).endDate).toBe("2027-01-01");
    expect(generatedOccurrence("2024-02-29", definition("night")).endDate).toBe("2024-03-01");
    expect(generatedOccurrence("2026-09-01", definition("night")).id).toBe(night.id);
  });

  it("creates all-day events and no occurrence for skip", () => {
    const allDay = definition("training", {
      primaryCode: "X",
      displayName: "培训",
      kind: "all-day",
      startTime: null,
      endTime: null,
      crossesMidnight: false,
    });
    expect(generatedOccurrence("2026-09-01", allDay).event.allDay.value).toBe(true);
    const skip = definition("off", {
      primaryCode: "OFF",
      displayName: "休息",
      kind: "skip",
      startTime: null,
      endTime: null,
      crossesMidnight: false,
    });
    expect(
      generateShiftOccurrence(
        assignment("person-1", "date-1", "off"),
        person(),
        date("2026-09-01"),
        skip,
        config,
      ).occurrence,
    ).toBeNull();
  });

  it("detects cross-night overlap but not touching endpoints or different people", () => {
    const night = generatedOccurrence("2026-09-01", definition("night"));
    const early = generatedOccurrence(
      "2026-09-02",
      definition("early", { startTime: "07:00", endTime: "15:00" }),
      person(),
      assignment("person-1", "date-1", "early"),
    );
    expect(
      detectShiftConflicts([night, early])[0].warnings.some(
        (warning) => warning.code === "SHIFT_OCCURRENCE_CONFLICT",
      ),
    ).toBe(true);
    const touching = generatedOccurrence(
      "2026-09-02",
      definition("touching", { startTime: "08:00", endTime: "16:00" }),
      person(),
      assignment("person-1", "date-1", "touching"),
    );
    expect(detectShiftConflicts([night, touching]).flatMap((item) => item.warnings)).toHaveLength(
      0,
    );
    expect(
      detectShiftConflicts([
        night,
        generatedOccurrence(
          "2026-09-02",
          definition("early", { startTime: "07:00", endTime: "15:00" }),
          person("person-2", "李四"),
          assignment("person-2", "date-1", "early"),
        ),
      ]).flatMap((item) => item.warnings),
    ).toHaveLength(0);
  });

  it("preserves exclusions by stable occurrence id and removes them from conflicts", () => {
    const initial = generatedOccurrence("2026-09-01", definition("night"));
    const result = generateShiftOccurrences(
      [assignment("person-1", "date-1", "night")],
      [person()],
      [date("2026-09-01")],
      [definition("night", { displayName: "值夜班" })],
      config,
      new Set([initial.id]),
    );
    expect(result.occurrences[0].excludedByUser).toBe(true);
    expect(result.occurrences[0].warnings).toHaveLength(0);
  });

  it("blocks unresolved assignments and builds team titles only when valid", () => {
    const first = generatedOccurrence("2026-09-01", definition());
    const secondPerson = person("person-2", "李四");
    const second = generatedOccurrence(
      "2026-09-01",
      definition("night"),
      secondPerson,
      assignment("person-2", "date-1", "night"),
    );
    const unresolved = { ...assignment(), status: "unmapped" as const, shiftDefinitionId: null };
    expect(
      selectShiftEventsForExport([first], [unresolved], [person()], {
        mode: "individual",
        personId: "person-1",
      }).valid,
    ).toBe(false);
    const team = selectShiftEventsForExport(
      [first, second],
      [assignment(), assignment("person-2", "date-1", "night")],
      [person(), secondPerson],
      { mode: "team" },
    );
    expect(team.valid).toBe(true);
    expect(team.events.map((event) => event.title.value)).toEqual(["张三 · 早班", "李四 · 夜班"]);
  });
});
