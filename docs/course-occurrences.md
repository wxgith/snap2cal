# 课程具体事件

## 日期计算

用户必须输入“第一教学周的星期一日期”，且该日期必须确实是星期一。对第 `weekNumber` 周课程：

```text
date = weekOneMonday + (weekNumber - 1) * 7 + weekdayOffset
```

`weekdayOffset` 从周一 `0` 到周日 `6`。计算使用 UTC 日历算术处理月末、跨月、闰年和跨年，但输出保持本地 `YYYY-MM-DD`；不读取系统当前日期，也不把时区偏移加到日历日。

occurrence ID 包含模板 ID、教学周编号和具体日期。同一模板、配置和周次必然得到同一 ID；修改第一周日期后 ID 随日期变化，旧排除项不会污染新日期。

## 排除与冲突

取消课程模板会停止生成其导出事件。排除单次 occurrence 只把该确定性 ID 放入页面内存集合，不删除模板；重新勾选即可恢复。

冲突检测比较同一日期的半开时间区间。完全相同或部分重叠会在双方 occurrence 上产生 `COURSE_CONFLICT_DETECTED`，相邻但不重叠、不同日期、未选择模板和已排除项不参与冲突。冲突只警告，绝不自动删除或取消选择。

## ICS

每个有效 occurrence 转为已有 `EventDraft`。课程名称写入 `SUMMARY`，地点写入 `LOCATION`，教师和课程备注写入 `DESCRIPTION`，用户默认提醒写入 `VALARM`。随后复用 `generateCalendarIcs` 在一个 `VCALENDAR` 中生成独立 UID 的多个 `VEVENT`。

本阶段刻意不使用 `RRULE`：显式事件便于排除某次课程、显示冲突并保持周次数组的确定性，也避免把调停课或校历例外伪装成已支持。无效标题、时间或日期不会被静默跳过；选中集合包含无效项时导出整体阻止。为防止误操作和浏览器卡顿，单次生成上限为 1000 条 occurrence。
