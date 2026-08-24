import { describe, expect, it } from "vitest";
import { parseDates } from "./date";

const options = {
  referenceDateTime: new Date("2026-08-23T10:00:00+08:00"),
  timeZone: "Asia/Shanghai",
};
const parse = (input: string) => parseDates(input, options);

describe("parseDates", () => {
  it.each([
    ["2026年8月26日", "2026-08-26"],
    ["2026-08-26", "2026-08-26"],
    ["2026/8/26", "2026-08-26"],
    ["今天", "2026-08-23"],
    ["明天", "2026-08-24"],
    ["后天", "2026-08-25"],
    ["本周五", "2026-08-21"],
    ["下周一", "2026-08-24"],
  ])("解析 %s", (input, expected) => expect(parse(input).selected?.value).toBe(expected));

  it("为无年份日期选择最近的未来日期并记录推断", () => {
    const result = parse("8月26日");
    expect(result.selected?.value).toBe("2026-08-26");
    expect(result.selected?.derivedFromDefault).toBe(true);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "INFERRED_YEAR" }));
  });

  it("提示已经过去的本周日期", () =>
    expect(parse("本周五").warnings).toContainEqual(
      expect.objectContaining({ code: "PAST_DATE" }),
    ));

  it("拒绝无效日期", () => {
    const result = parse("2月30日");
    expect(result.selected).toBeUndefined();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "INVALID_DATE" }));
  });
});
