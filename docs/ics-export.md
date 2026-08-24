# ICS 导出策略

## 字段映射

`EventDraft` 映射为单个 `VEVENT`：标题到 `SUMMARY`，日期和时间到 `DTSTART/DTEND`，地点到 `LOCATION`，备注及原文到 `DESCRIPTION`，事件 ID 构成唯一 `UID`。`DTSTAMP` 使用生成时刻的 UTC 值。

`generateIcs(event)` 保持单事件兼容。`generateCalendarIcs(events)` 复用同一 `VEVENT` 行生成函数，在一个 `VCALENDAR` 中顺序写入多个 `VEVENT`；每个事件有独立 UID，共用同一次 UTC `DTSTAMP` 生成时刻。

## 全天事件

全天事件使用 `DTSTART;VALUE=DATE`。根据 RFC 5545，`DTEND` 是不包含的结束边界：单日全天事件的结束值为开始日次日；若用户填写结束日期，则将该日期视为用户可见的最后一天，导出值再加一天。

## 无结束时间

非全天事件没有结束时间时不生成 `DTEND`，不擅自添加固定时长。RFC 5545 允许仅含 `DTSTART` 的事件；导入客户端自行显示瞬时或无明确时长事件。结束时间存在但结束日期为空时，使用开始日期，此默认值在解析结果中可追溯。

## 时区

本地日期时间使用 `TZID=<EventDraft.timeZone>`，不转换成 UTC。默认值来自浏览器 `Intl.DateTimeFormat().resolvedOptions().timeZone`；检测失败时使用 UTC 并产生 `TIMEZONE_FALLBACK`。第一阶段不内嵌 `VTIMEZONE`，依赖客户端的 IANA 时区数据库。

## 提醒

仅当提醒分钟数非空时生成 `VALARM`，使用相对开始时间的 `TRIGGER:-PT<n>M`、`ACTION:DISPLAY` 和事件标题。负数在导出校验阶段被拒绝。

## 编码和转义

文件以 UTF-8 Blob `text/calendar;charset=utf-8` 下载，使用 CRLF 行结束。反斜杠、逗号、分号和换行分别转义为 `\\`、`\,`、`\;` 和 `\n`。文件名由日期与标题生成，并移除 Windows 和常见文件系统非法字符。

## 多事件校验与文件名

批量导出只接收 UI 中已勾选且未忽略的候选，但生成器仍逐项调用 `validateEvent`。只要一个传入事件无效，`generateCalendarIcs` 就抛出带候选序号的 `BatchIcsValidationError`，不会静默跳过。重复候选只显示提示，是否导出由用户决定。

多事件文件名为 `<最早开始日期>-<事件数>-events-snap2cal.ics`；无可用日期时使用 `undated`。空事件数组同样拒绝生成。

## 课程表导出

课程表不会新增另一套 `VEVENT` 生成器。`CourseTemplate` 根据用户填写的第一教学周星期一、总周数、星期列、实际时间和明确 `weeks` 数组展开为 `CourseOccurrence`；每个 occurrence 包含一个现有 `EventDraft`，最后统一交给 `generateCalendarIcs(events)`。

课程日期属于可见推断，事件中带 `SCHEDULE_DATE_DERIVED` 提示。没有明确时间、标题或有效周次的课程不能生成 occurrence；没有地点则保持 `LOCATION` 为空；教师写入 `DESCRIPTION`。未写周次时只使用用户明确选择的默认周次并显示 `COURSE_WEEK_PATTERN_MISSING`，不会静默采用学校规则。

用户取消整门课程或排除某次 occurrence 后，相应事件不进入导出；冲突只提示、不自动删除。课程表文件名为 `<第一教学周星期一>-<事件数>-classes-snap2cal.ics`。每次课程使用独立 UID 和 `VEVENT`，当前不生成 `RRULE`，也不自动处理节假日、调课、停课或补课例外。

## 排班表导出

排班表同样不新增 `VEVENT` 生成器。每个有效 `ShiftOccurrence` 内含现有 `EventDraft`：班次名称写入 `SUMMARY`，班次地点写入 `LOCATION`，人员、原始班次代码、排班日期和说明写入 `DESCRIPTION`。团队模式默认在标题前加人员姓名；个人模式不会重复添加姓名。

当日定时班的 `DTSTART/DTEND` 使用同一排班日期；显式确认的跨夜班将 `DTEND` 写到日历次日，可跨月和跨年。`all-day` 沿用不包含结束边界的全天导出规则。`skip` 保留 assignment 但不创建 occurrence，也不生成 `VEVENT`。单次排除只过滤对应 occurrence。

个人和团队导出都会先检查选中人员的所有非空 assignment；存在未映射、冲突定义或无效事件时整体阻止，不做静默部分导出。团队文件只有一个 `VCALENDAR`，每个 occurrence 是独立 `VEVENT` 和 UID，绝不生成 `RRULE`。
