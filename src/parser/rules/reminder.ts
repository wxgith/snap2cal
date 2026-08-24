import { makeSource } from "../../domain/event";
import type { RuleMatch } from "../types";
import { REMINDER_PATTERN } from "./patterns";

export function parseReminder(input: string): RuleMatch<number> | undefined {
  const match = new RegExp(
    REMINDER_PATTERN.source.replace("(\\d+)", "(\\d+|一)"),
    REMINDER_PATTERN.flags,
  ).exec(input);
  if (!match) return undefined;
  const amount = match[1] === "一" ? 1 : Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "小时" ? 60 : unit === "天" || unit === "日" || unit === "一天" ? 1440 : 1;
  return {
    value: amount * multiplier,
    source: makeSource(input, match.index, match[0]),
    confidence: "high",
    warnings: [],
  };
}
