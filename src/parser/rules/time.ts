import { makeSource, type ExtractionWarning } from "../../domain/event";
import type { RuleMatch } from "../types";
import { TIME_TOKEN_PATTERN } from "./patterns";

type Period = "上午" | "下午" | "晚上" | "凌晨" | "中午";
interface ParsedToken extends RuleMatch<string> {
  period?: Period;
  rawHour: number;
}

function convertHour(hour: number, period?: Period): number {
  if ((period === "下午" || period === "晚上") && hour < 12) return hour + 12;
  if (period === "凌晨" && hour === 12) return 0;
  return hour;
}

function parseToken(
  input: string,
  match: RegExpExecArray,
  inheritedPeriod?: Period,
): ParsedToken | undefined {
  const explicitPeriod = match[1] as Period | undefined;
  const period = explicitPeriod ?? inheritedPeriod;
  const hour = Number(match[2] ?? match[4]);
  const minute =
    match[3] !== undefined
      ? Number(match[3])
      : match[0].endsWith("半")
        ? 30
        : Number(match[5] ?? 0);
  if (hour > 23 || minute > 59 || (period && hour > 12)) return undefined;
  const warnings: ExtractionWarning[] = [];
  if (!explicitPeriod && !inheritedPeriod && match[4] !== undefined) {
    warnings.push({
      code: "AMBIGUOUS_TIME_PERIOD",
      message: `“${match[0]}”缺少上午或下午信息，当前暂按 ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")} 处理，请确认。`,
      severity: "warning",
      relatedField: "startTime",
    });
  }
  if (
    (explicitPeriod === "晚上" && hour === 12) ||
    (explicitPeriod === "中午" && hour === 1) ||
    (explicitPeriod === "凌晨" && hour === 12)
  ) {
    warnings.push({
      code: "AMBIGUOUS_TIME_PERIOD",
      message: `“${match[0]}”存在日期或时段歧义，已按常见 24 小时表示转换，请人工确认。`,
      severity: "warning",
      relatedField: "startTime",
    });
  }
  const converted = convertHour(hour, period);
  return {
    value: `${converted.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
    source: makeSource(input, match.index, match[0]),
    confidence: warnings.length ? "medium" : "high",
    warnings,
    period,
    rawHour: hour,
  };
}

export interface TimeRuleResult {
  start?: RuleMatch<string>;
  end?: RuleMatch<string>;
  warnings: ExtractionWarning[];
}

export function parseTimes(input: string): TimeRuleResult {
  const matches = Array.from(
    input.matchAll(new RegExp(TIME_TOKEN_PATTERN.source, TIME_TOKEN_PATTERN.flags)),
  );
  const first = matches[0] ? parseToken(input, matches[0]) : undefined;
  const warnings = [...(first?.warnings ?? [])];
  if (!first) return { warnings };
  const secondMatch = matches[1];
  let end: ParsedToken | undefined;
  if (secondMatch) {
    const between = input.slice(first.source.endIndex, secondMatch.index);
    if (/^\s*(?:到|至|-|—|–)\s*$/.test(between)) {
      end = parseToken(input, secondMatch, first.period);
      warnings.push(...(end?.warnings ?? []));
      if (end && end.value < first.value) {
        warnings.push({
          code: "END_BEFORE_START",
          message: "结束时间早于开始时间，系统不会自动按跨天处理，请确认。",
          severity: "error",
          relatedField: "endTime",
        });
      }
    }
  }
  return { start: first, end, warnings };
}
