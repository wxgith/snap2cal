# 排班表二维架构

## 独立语义层

排班表与课程表都从二维位置获得语义，但含义不同：排班表的行是人员、列是具体日期、格内是班次代码；课程表的列是星期、行是时段、格内是课程。排班逻辑位于独立 `shift-roster` 模块，绝不使用 `CourseTemplate` 表示人员班次。

共享范围只包括规范化图片、本地 `OcrDocument`、`ProjectionGridDetector`、`TableGrid`、`GridCell`、OCR 几何分配、`EventDraft` 校验和多 `VEVENT` ICS：

```text
Image
-> OcrDocument
-> GridDetector
-> TableGrid
-> GridCell
-> RosterCell / RosterHeaderMapping
-> RosterPerson / RosterDateColumn
-> ShiftDefinition
-> ShiftAssignment
-> ShiftOccurrence
-> EventDraft
-> generateCalendarIcs
```

`RosterPerson` 保留人员行、显示名称、可选员工编号、来源格和导出选择；重复姓名只警告、不合并，也不用于推断任何敏感属性。`RosterDateColumn` 保存日期列、原始表头、规范日期、可选星期校验和真实来源格。`ShiftDefinition` 是用户确认的精确代码映射。`ShiftAssignment` 保存某人某日来源格、不可变 OCR 原文、规范代码、映射状态和警告。`ShiftOccurrence` 是可导出的具体日期事件及排除/冲突状态。

## 数量与能力边界

单次最多 100 人、31 个日期列、3100 个 assignment 和 3100 个 occurrence。超限会显示错误并停止生成，不会截断后静默导出。

只支持单张清晰矩形“人员行 × 日期列”截图、每人一行、每格最多一个班次。支持当日定时、显式跨夜、全天和跳过。当前不支持反向表格、一人多行、合并人员格、多段班、24 小时班次、无边框卡片、透视、PDF/Excel/CSV、多图、自动排班、换班审批、考勤、工资、工时、劳动法规或合理性判断。

排班工作区通过 `React.lazy` 单独加载。首次进入后保持挂载但在其他模式隐藏，因此页面内模式切换保留内存状态；刷新或关闭页面清除全部数据。
