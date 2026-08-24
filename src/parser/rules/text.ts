import { makeSource } from "../../domain/event";
import type { RuleMatch } from "../types";
import { EXPLICIT_LOCATION_PATTERN, EXPLICIT_TITLE_PATTERN, IN_LOCATION_PATTERN } from "./patterns";

function firstMatch(pattern: RegExp, input: string): RegExpExecArray | null {
  return new RegExp(pattern.source, pattern.flags).exec(input);
}

export interface TextRuleResult {
  title?: RuleMatch<string>;
  location?: RuleMatch<string>;
  description?: RuleMatch<string>;
}

export function parseTextFields(
  input: string,
  consumedRanges: Array<[number, number]>,
): TextRuleResult {
  const explicitLocation = firstMatch(EXPLICIT_LOCATION_PATTERN, input);
  const inLocation = firstMatch(IN_LOCATION_PATTERN, input);
  let location: RuleMatch<string> | undefined;
  if (explicitLocation) {
    const value = explicitLocation[1].trim();
    const start = explicitLocation.index + explicitLocation[0].indexOf(explicitLocation[1]);
    location = {
      value,
      source: makeSource(input, start, explicitLocation[1]),
      confidence: "high",
      warnings: [],
    };
    consumedRanges.push([
      explicitLocation.index,
      explicitLocation.index + explicitLocation[0].length,
    ]);
  } else if (inLocation) {
    const value = inLocation[1].trim();
    const start = inLocation.index + inLocation[0].indexOf(inLocation[1]);
    location = {
      value,
      source: makeSource(input, start, inLocation[1]),
      confidence: "medium",
      warnings: [],
    };
    consumedRanges.push([inLocation.index, start + inLocation[1].length]);
  }

  const explicitTitle = firstMatch(EXPLICIT_TITLE_PATTERN, input);
  let title: RuleMatch<string> | undefined;
  if (explicitTitle) {
    const value = explicitTitle[1].trim();
    const start = explicitTitle.index + explicitTitle[0].indexOf(explicitTitle[1]);
    title = {
      value,
      source: makeSource(input, start, explicitTitle[1]),
      confidence: "high",
      warnings: [],
    };
  } else if (inLocation) {
    const verb = inLocation[2];
    const object = inLocation[3].trim();
    const value =
      verb === "看" || verb === "吃" || verb === "上"
        ? `${verb}${object}`
        : object || `${verb}${object}`;
    if (value) {
      const start = inLocation.index + inLocation[0].indexOf(verb);
      title = {
        value,
        source: makeSource(input, start, `${verb}${inLocation[3]}`),
        confidence: "medium",
        warnings: [],
      };
      consumedRanges.push([start, inLocation.index + inLocation[0].length]);
    }
  }

  const noteMatch = /(?:记得|请|备注[：:]?)\s*([^，,；;。\n]+)/.exec(input);
  let description: RuleMatch<string> | undefined;
  if (noteMatch) {
    const value = `${noteMatch[0].startsWith("记得") ? "记得" : ""}${noteMatch[1]}`.trim();
    description = {
      value,
      source: makeSource(input, noteMatch.index, noteMatch[0]),
      confidence: "medium",
      warnings: [],
    };
    consumedRanges.push([noteMatch.index, noteMatch.index + noteMatch[0].length]);
  }

  if (!title) {
    const chars = [...input];
    for (const [start, end] of consumedRanges) for (let i = start; i < end; i += 1) chars[i] = " ";
    const remaining = chars
      .join("")
      .replace(/(?:活动时间|会议时间|开始时间|报名截止)\s*[：:]?/g, " ")
      .replace(/[，,；;。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (remaining && remaining.length <= 30 && !/^\d+$/.test(remaining)) {
      const start = input.indexOf(remaining);
      title = {
        value: remaining,
        source: start >= 0 ? makeSource(input, start, remaining) : makeSource(input, 0, input),
        confidence: "low",
        warnings: [],
      };
    }
  }
  return { title, location, description };
}
