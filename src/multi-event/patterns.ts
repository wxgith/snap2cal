/** Boundary-only expressions. Date/time interpretation remains in the single-event parser. */
export const BULLET_PREFIX = /^\s*[-*•·]\s+/;
export const NUMBERED_PREFIX = /^\s*(?:(?:\d+)[.、)]|[（(]\d+[）)]|[一二三四五六七八九十]+、)\s*/;
export const EXPLICIT_EVENT_PREFIX =
  /^\s*(?:活动|事件)\s*(?:\d+|[一二三四五六七八九十]+)\s*[：:、.]?\s*/;

export const BOUNDARY_DATE =
  /(?:\d{4}年\d{1,2}月\d{1,2}[日号]?|\d{4}[-/]\d{1,2}[-/]\d{1,2}|(?<!\d{4}年)\d{1,2}月\d{1,2}[日号]|今天|明天|后天|(?:本周|这周|下周)[一二三四五六日天])/;
export const BOUNDARY_TIME =
  /(?:(?:上午|下午|晚上|凌晨|中午)\s*)?(?:\d{1,2}:\d{2}|\d{1,2}点(?:\d{1,2}分?|半)?)/;
export const ALL_DAY_BOUNDARY = /全天|整天/;
export const LOCATION_HEADING = /^\s*(?:地点|地址)\s*[：:]\s*(.+?)\s*$/;

export function hasDateExpression(value: string): boolean {
  return BOUNDARY_DATE.test(value);
}

export function hasTimeExpression(value: string): boolean {
  return BOUNDARY_TIME.test(value);
}

export function looksLikeCompleteEvent(value: string, inheritedDate = false): boolean {
  const hasDate = hasDateExpression(value) || inheritedDate;
  const hasTiming = hasTimeExpression(value) || ALL_DAY_BOUNDARY.test(value);
  const remainder = value
    .replace(BOUNDARY_DATE, "")
    .replace(BOUNDARY_TIME, "")
    .replace(ALL_DAY_BOUNDARY, "")
    .replace(/[\s，,；;。:：\-–—]/g, "");
  return hasDate && hasTiming && remainder.length > 0;
}
