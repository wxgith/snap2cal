import { makeSource, type ExtractionWarning } from "../../domain/event";
import {
  addCalendarDays,
  formatDate,
  getDatePartsInTimeZone,
  isValidDate,
  weekdayMondayBased,
} from "../../utils/date";
import type { ParseEventTextOptions, RuleMatch } from "../types";
import { DATE_PATTERNS } from "./patterns";

type Groups = Record<string, string | undefined>;

function execAll(pattern: RegExp, input: string): RegExpExecArray[] {
  const copy = new RegExp(pattern.source, pattern.flags);
  return Array.from(input.matchAll(copy));
}

function invalidWarning(text: string): ExtractionWarning {
  return {
    code: "INVALID_DATE",
    message: `日期“${text}”无效，请人工确认。`,
    severity: "error",
    relatedField: "startDate",
  };
}

export interface DateRuleResult {
  selected?: RuleMatch<string>;
  candidates: RuleMatch<string>[];
  warnings: ExtractionWarning[];
}

export function parseDates(input: string, options: ParseEventTextOptions): DateRuleResult {
  const reference = getDatePartsInTimeZone(options.referenceDateTime, options.timeZone);
  const candidates: RuleMatch<string>[] = [];
  const warnings: ExtractionWarning[] = [];
  const occupied: Array<[number, number]> = [];

  for (const pattern of [DATE_PATTERNS.chineseFull, DATE_PATTERNS.numericFull]) {
    for (const match of execAll(pattern, input)) {
      const groups = (match.groups ?? {}) as Groups;
      const year = Number(groups.year);
      const month = Number(groups.month);
      const day = Number(groups.day);
      const source = makeSource(input, match.index, match[0]);
      occupied.push([source.startIndex, source.endIndex]);
      if (!isValidDate(year, month, day)) {
        warnings.push(invalidWarning(match[0]));
        continue;
      }
      candidates.push({
        value: formatDate({ year, month, day }),
        source,
        confidence: "high",
        warnings: [],
      });
    }
  }

  for (const match of execAll(DATE_PATTERNS.monthDay, input)) {
    const end = match.index + match[0].length;
    if (occupied.some(([start, occupiedEnd]) => match.index >= start && end <= occupiedEnd))
      continue;
    const groups = (match.groups ?? {}) as Groups;
    const month = Number(groups.month);
    const day = Number(groups.day);
    let year = reference.year;
    if (!isValidDate(year, month, day)) {
      warnings.push(invalidWarning(match[0]));
      continue;
    }
    const current = formatDate(reference);
    if (formatDate({ year, month, day }) < current) year += 1;
    if (!isValidDate(year, month, day)) {
      warnings.push(invalidWarning(match[0]));
      continue;
    }
    const warning: ExtractionWarning = {
      code: "INFERRED_YEAR",
      message: `“${match[0]}”未包含年份，已推断为 ${year} 年。`,
      severity: "info",
      relatedField: "startDate",
    };
    candidates.push({
      value: formatDate({ year, month, day }),
      source: makeSource(input, match.index, match[0]),
      confidence: "medium",
      derivedFromDefault: true,
      warnings: [warning],
    });
    warnings.push(warning);
  }

  for (const match of execAll(DATE_PATTERNS.relative, input)) {
    const offset = match[0] === "今天" ? 0 : match[0] === "明天" ? 1 : 2;
    candidates.push({
      value: formatDate(addCalendarDays(reference, offset)),
      source: makeSource(input, match.index, match[0]),
      confidence: "high",
      warnings: [],
    });
  }

  const weekdayMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
  };
  for (const match of execAll(DATE_PATTERNS.week, input)) {
    const target = weekdayMap[match[0].slice(-1)];
    const isNext = match[0].startsWith("下周");
    const offset = (isNext ? 7 : 0) - weekdayMondayBased(reference) + target;
    const value = formatDate(addCalendarDays(reference, offset));
    const matchWarnings: ExtractionWarning[] = [];
    if (offset < 0) {
      const warning: ExtractionWarning = {
        code: "PAST_DATE",
        message: `“${match[0]}”位于本周且已经过去，请确认日期。`,
        severity: "warning",
        relatedField: "startDate",
      };
      warnings.push(warning);
      matchWarnings.push(warning);
    }
    candidates.push({
      value,
      source: makeSource(input, match.index, match[0]),
      confidence: "high",
      warnings: matchWarnings,
    });
  }

  for (const match of execAll(DATE_PATTERNS.unsupportedWeek, input)) {
    warnings.push({
      code: "UNSUPPORTED_EXPRESSION",
      message: `暂不支持无前缀星期表达“${match[0]}”，请改用“本周”或“下周”。`,
      severity: "warning",
      relatedField: "startDate",
    });
  }

  const unique = candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (other) =>
          other.source.startIndex === candidate.source.startIndex &&
          other.source.endIndex === candidate.source.endIndex,
      ) === index,
  );
  let selected = unique[0];
  if (unique.length > 1) {
    const labeled = unique.find((candidate) =>
      /(?:活动时间|会议时间|开始时间)\s*[：:]?\s*$/.test(
        input.slice(Math.max(0, candidate.source.startIndex - 8), candidate.source.startIndex),
      ),
    );
    selected = labeled ?? unique[0];
    warnings.push({
      code: "MULTIPLE_DATE_CANDIDATES",
      message: `检测到多个日期候选：${unique.map((item) => `${item.source.text}（${item.value}）`).join("、")}。${labeled ? `已优先选择带活动时间标签的 ${labeled.value}` : "当前选择第一个，请人工确认"}。`,
      severity: labeled ? "warning" : "error",
      relatedField: "startDate",
    });
  }
  return { selected, candidates: unique, warnings };
}
