import { describe, expect, it } from "vitest";
import { createShiftDefinition, normalizeShiftCode, validateShiftDefinitions } from "./shifts";
import type { ShiftDefinition } from "./types";

function definition(patch: Partial<ShiftDefinition> = {}): ShiftDefinition {
  return {
    ...createShiftDefinition("A"),
    displayName: "早班",
    startTime: "08:00",
    endTime: "16:00",
    manuallyConfirmed: true,
    ...patch,
  };
}

describe("shift definitions", () => {
  it.each([
    [" a ", "A"],
    ["Ａ", "A"],
    [" 夜 ", "夜"],
    ["off", "OFF"],
    ["-", "-"],
    ["/", "/"],
    ["0", "0"],
    [" 08:00 ", "08:00"],
  ])("normalizes %s exactly", (input, expected) => {
    expect(normalizeShiftCode(input)).toBe(expected);
  });

  it("requires explicit cross-midnight confirmation", () => {
    const missing = validateShiftDefinitions([
      definition({ id: "night", primaryCode: "N", startTime: "20:00", endTime: "08:00" }),
    ]);
    expect(missing.warnings.some((item) => item.code === "SHIFT_CROSS_MIDNIGHT_REQUIRED")).toBe(
      true,
    );
    const valid = validateShiftDefinitions([
      definition({
        id: "night",
        primaryCode: "N",
        startTime: "20:00",
        endTime: "08:00",
        crossesMidnight: true,
      }),
    ]);
    expect(valid.warnings).toHaveLength(0);
  });

  it("rejects 24-hour and invalid cross-midnight configurations", () => {
    expect(
      validateShiftDefinitions([
        definition({ startTime: "08:00", endTime: "08:00" }),
      ]).warnings.some((item) => item.code === "SHIFT_TWENTY_FOUR_HOUR_UNSUPPORTED"),
    ).toBe(true);
    expect(
      validateShiftDefinitions([definition({ crossesMidnight: true })]).warnings.some(
        (item) => item.code === "SHIFT_CROSS_MIDNIGHT_INVALID",
      ),
    ).toBe(true);
  });

  it("supports all-day and skip while blocking alias conflicts", () => {
    const allDay = definition({
      id: "training",
      primaryCode: "X",
      kind: "all-day",
      startTime: null,
      endTime: null,
    });
    const skip = definition({
      id: "off",
      primaryCode: "OFF",
      kind: "skip",
      startTime: null,
      endTime: null,
    });
    expect(validateShiftDefinitions([allDay, skip]).warnings).toHaveLength(0);
    const conflict = validateShiftDefinitions([
      definition({ id: "a", aliases: ["早"] }),
      definition({ id: "b", primaryCode: "B", aliases: ["早"] }),
    ]);
    expect(conflict.warnings.some((item) => item.code === "SHIFT_CODE_ALIAS_CONFLICT")).toBe(true);
  });
});
