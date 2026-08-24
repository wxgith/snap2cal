# 课程表二维架构

## 为什么独立建模

普通文字和 OCR 阅读顺序是一维字符串，多事件模块据此生成 `CandidateSegment`。课程表语义来自二维位置：同一列表示同一星期，同一行表示同一时间段，纵向跨度表示持续多个时间段。因此课程表由独立 `schedule-table` 模块处理，不调用 `CandidateSegmenter`，也不改变 `parseEventText` 或 `parseEventCandidates` 的返回类型。

生产数据流为：

```text
Image
-> OcrDocument
-> GridDetector
-> TableGrid
-> GridCell / CellTextDocument
-> ScheduleHeaderMapping / ScheduleTimeSlot
-> CourseTemplate / WeekPattern
-> CourseOccurrence
-> EventDraft
-> generateCalendarIcs
```

课程表入口使用 `React.lazy`。首次进入后组件保持挂载但在其他模式中隐藏，所以模式切换不会清除课程表内存状态；普通文字和图片模式也不会加载课程表像素算法到首屏主包。

## 模型职责

- `TableGrid`：规范化图片自然宽高、排序后的水平/垂直线、检测置信度和网格警告。
- `GridCell`：由相邻线形成，保存行列、纵向跨度、自然坐标框、OCR block id、不可变 `originalText` 和可编辑 `text`。
- `ScheduleHeaderMapping`：星期标题行、时间标题列和唯一的 weekday 列映射。
- `ScheduleTimeSlot`：每一数据行的标签与明确 `HH:mm` 起止时间；节次标签本身不是时间。
- `CourseTemplate`：课程字段、星期、开始/结束行、明确周数组与导出选择。
- `CourseOccurrence`：模板在某教学周的具体日期事件、用户排除状态和冲突警告。

## 状态失效

- 换图、删图或重新 OCR：取消旧任务并清除网格及下游状态。
- OCR 文字校正：保留网格，重新分配单元格，清除模板和 occurrence。
- 移动、添加、删除或恢复网格线：立即重建单元格，网格重新变为未确认，清除表头确认、模板、排除项和 occurrence。
- 修改表头或时间：保留网格与单元格，清除模板和 occurrence。
- 修改第一教学周星期一：重新生成带日期的 occurrence ID，旧日期排除项不会迁移。
- 修改总周数或默认周次：清除模板，要求重新解析周次。
- 修改模板周次：重新生成 occurrence，并清除旧排除项。
- 排除 occurrence：只保存该确定性 occurrence ID，不删除模板。

## 边界

只支持单张、无旋转或已规范化、清晰矩形直线网格的周课程表。首版只允许课程格在同一星期列中纵向合并。不支持无边框卡片、手绘或透视表、多份表、多级表头、横跨星期、不规则或嵌套表格、PDF/Excel/CSV、考试表、日历月视图、排班表、校历例外、调停课、后端或第三方日历授权。
