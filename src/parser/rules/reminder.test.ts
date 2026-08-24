import { describe, expect, it } from "vitest";
import { parseReminder } from "./reminder";

describe("parseReminder", () => {
  it.each([
    ["提前30分钟提醒", 30],
    ["提前1小时提醒", 60],
    ["提前2小时提醒", 120],
    ["提前一天提醒", 1440],
  ])("解析 %s", (input, expected) => expect(parseReminder(input)?.value).toBe(expected));
  it("没有提醒时返回 undefined", () => expect(parseReminder("明天开会")).toBeUndefined());
});
