import type { ScheduleWarning, WeekPattern, WeekPatternKind } from "./types";

export interface WeekPatternParseResult {
  pattern: WeekPattern;
  warnings: ScheduleWarning[];
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

export function createAllWeeksPattern(totalWeeks: number): WeekPattern {
  return {
    kind: "all",
    weeks: range(1, Math.max(0, totalWeeks)),
    originalExpression: "每周",
    derivedFromDefault: false,
    manuallyEdited: false,
  };
}

function normalizeWeeks(weeks: number[], totalWeeks: number): number[] {
  return [...new Set(weeks)]
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= totalWeeks)
    .sort((a, b) => a - b);
}

export function parseWeekPattern(
  text: string,
  totalWeeks: number,
  fallback?: WeekPattern,
): WeekPatternParseResult {
  const warnings: ScheduleWarning[] = [];
  const explicitWeeks: number[] = [];
  let originalExpression: string | undefined;
  let kind: WeekPatternKind = "explicit";

  const combinedPattern =
    /((?:\d{1,2}(?:\s*[-—–~至]\s*\d{1,2})?\s*[,，、]\s*)+\d{1,2}(?:\s*[-—–~至]\s*\d{1,2})?)\s*周/g;
  for (const match of text.matchAll(combinedPattern)) {
    originalExpression = originalExpression ? `${originalExpression},${match[0]}` : match[0];
    for (const part of match[1].split(/[,，、]/)) {
      const rangeMatch = /(\d{1,2})(?:\s*[-—–~至]\s*(\d{1,2}))?/.exec(part);
      if (!rangeMatch) continue;
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2] ?? rangeMatch[1]);
      if (end >= start) explicitWeeks.push(...range(start, end));
    }
  }

  const listPattern = /((?:\d{1,2}\s*[,，、]\s*)+\d{1,2})\s*周/g;
  for (const match of text.matchAll(listPattern)) {
    originalExpression = originalExpression ? `${originalExpression},${match[0]}` : match[0];
    explicitWeeks.push(...match[1].split(/[,，、]/).map(Number));
  }
  const rangePattern = /(?:第\s*)?(\d{1,2})(?:\s*[-—–~至]\s*(\d{1,2}))?\s*周/g;
  for (const match of text.matchAll(rangePattern)) {
    if (match.index !== undefined && listPattern.test(match[0])) continue;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    originalExpression = originalExpression ? `${originalExpression},${match[0]}` : match[0];
    if (end < start) {
      warnings.push({
        code: "COURSE_WEEK_PATTERN_INVALID",
        message: `周次范围“${match[0]}”的结束周早于开始周。`,
        severity: "error",
        scope: "template",
      });
    } else explicitWeeks.push(...range(start, end));
  }

  const odd = /(?:^|[^单双])单周|[（(]\s*单\s*[)）]/.test(text);
  const even = /双周|[（(]\s*双\s*[)）]/.test(text);
  const all = /(?:每周|全周)/.test(text);
  if (odd && even)
    warnings.push({
      code: "COURSE_WEEK_PATTERN_INVALID",
      message: "同一课程同时包含单周和双周，无法确定上课周次。",
      severity: "error",
      scope: "template",
    });
  if (odd || even) {
    kind = odd ? "odd" : "even";
    const base = explicitWeeks.length ? explicitWeeks : range(1, totalWeeks);
    explicitWeeks.splice(
      0,
      explicitWeeks.length,
      ...base.filter((week) => (odd ? week % 2 === 1 : week % 2 === 0)),
    );
    originalExpression = originalExpression
      ? `${originalExpression}${odd ? "单周" : "双周"}`
      : odd
        ? "单周"
        : "双周";
  } else if (all) {
    kind = "all";
    explicitWeeks.splice(0, explicitWeeks.length, ...range(1, totalWeeks));
    originalExpression = originalExpression ?? "每周";
  }

  if (!originalExpression) {
    if (fallback) {
      return {
        pattern: {
          ...fallback,
          weeks: normalizeWeeks(fallback.weeks, totalWeeks),
          derivedFromDefault: true,
          manuallyEdited: false,
        },
        warnings: [
          {
            code: "COURSE_WEEK_PATTERN_MISSING",
            message: "课程未写明周次，已使用用户设置的默认周次，请确认。",
            severity: "warning",
            scope: "template",
          },
        ],
      };
    }
    return {
      pattern: {
        kind: "explicit",
        weeks: [],
        derivedFromDefault: false,
        manuallyEdited: false,
      },
      warnings: [
        {
          code: "COURSE_WEEK_PATTERN_MISSING",
          message: "课程缺少上课周次。",
          severity: "error",
          scope: "template",
        },
      ],
    };
  }

  const normalized = normalizeWeeks(explicitWeeks, totalWeeks);
  if (explicitWeeks.some((week) => week < 1 || week > totalWeeks))
    warnings.push({
      code: "COURSE_WEEK_PATTERN_INVALID",
      message: `部分周次超出 1-${totalWeeks} 周，已从可生成周次中截除，请确认。`,
      severity: "warning",
      scope: "template",
    });
  if (!normalized.length)
    warnings.push({
      code: "COURSE_WEEK_PATTERN_INVALID",
      message: "课程周次在当前学期范围内为空。",
      severity: "error",
      scope: "template",
    });
  return {
    pattern: {
      kind,
      weeks: normalized,
      originalExpression,
      derivedFromDefault: false,
      manuallyEdited: false,
    },
    warnings,
  };
}
