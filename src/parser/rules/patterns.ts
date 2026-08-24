/** Centralized expressions used by the transparent phase-one parser. */
export const DATE_PATTERNS = {
  chineseFull: /(?<year>\d{4})年(?<month>\d{1,2})月(?<day>\d{1,2})[日号]?/g,
  numericFull: /(?<year>\d{4})(?<separator>[-/])(?<month>\d{1,2})\k<separator>(?<day>\d{1,2})/g,
  monthDay: /(?<!\d{4}年)(?<month>\d{1,2})月(?<day>\d{1,2})[日号]/g,
  relative: /今天|明天|后天/g,
  week: /(?:本周|这周|下周)[一二三四五六日天]/g,
  unsupportedWeek: /(?<![本这下])(?:周|星期|礼拜)[一二三四五六日天]/g,
} as const;

export const TIME_TOKEN_PATTERN =
  /(?:(上午|下午|晚上|凌晨|中午)\s*)?(?:(\d{1,2}):(\d{2})|(\d{1,2})点(?:(\d{1,2})分?|半)?)/g;

export const REMINDER_PATTERN = /提前\s*(\d+)\s*(分钟|小时|天|日|一天)\s*(?:提醒)?/g;
export const ALL_DAY_PATTERN = /全天|整天/g;
export const EXPLICIT_LOCATION_PATTERN = /(?:地点|地址)\s*[：:]\s*([^，,；;。\n]+)/g;
export const IN_LOCATION_PATTERN =
  /在\s*([^，,；;。\n]+?)(看|开|参加|进行|举办|上|吃|办(?!公(?:室|楼|区)))([^，,；;。\n]*)/g;
export const EXPLICIT_TITLE_PATTERN = /(?:标题|活动)\s*[：:]\s*([^，,；;。\n]+)/g;
