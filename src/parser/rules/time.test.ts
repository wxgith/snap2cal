import { describe, expect, it } from "vitest";
import { parseTimes } from "./time";

describe("parseTimes", () => {
  it.each([
    ["下午3点", "15:00"],
    ["下午3点半", "15:30"],
    ["上午9点", "09:00"],
    ["晚上7点", "19:00"],
    ["凌晨1点", "01:00"],
    ["15:30", "15:30"],
  ])("解析 %s", (input, expected) => expect(parseTimes(input).start?.value).toBe(expected));

  it.each([
    ["上午9点到11点", "09:00", "11:00"],
    ["下午2点到4点", "14:00", "16:00"],
    ["15:00-17:30", "15:00", "17:30"],
    ["15:00 到 17:30", "15:00", "17:30"],
    ["9点至11点", "09:00", "11:00"],
  ])("解析范围 %s", (input, start, end) => {
    const result = parseTimes(input);
    expect(result.start?.value).toBe(start);
    expect(result.end?.value).toBe(end);
  });

  it.each(["晚上12点", "3点"])("对歧义表达 %s 给出警告", (input) => {
    expect(parseTimes(input).warnings).toContainEqual(
      expect.objectContaining({ code: "AMBIGUOUS_TIME_PERIOD" }),
    );
  });
});
