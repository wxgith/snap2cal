# 图片证据映射

## 坐标和规范化

上传图片先通过 `createImageBitmap(..., { imageOrientation: "from-image" })` 解码，使常见 EXIF 方向生效，再绘制到同尺寸 Canvas 并输出 PNG。预览和 OCR 使用同一规范化 Blob；自然宽高同时作为 SVG `viewBox`，OCR 框保存自然坐标，因此响应式缩放不改变映射。

## 阅读顺序和组合文本

文本块使用 OCR 行。排序键依次为 `lineIndex`、纵坐标、横坐标、OCR 顺序和稳定 ID。同一行的中文块直接连接；两个边界均为拉丁字母或数字时加入空格；不同行加入换行。

`combinedText` 只包含未忽略且非空的块。每次编辑或忽略状态变化都重新生成组合文本与 `OcrTextSegment`。`originalText` 始终保留初始 OCR 文字，人工编辑只修改 `text`。

## 索引约定和映射

`SourceSpan`、`combinedText`、`OcrTextSegment` 全部使用 JavaScript 字符串原生 UTF-16 索引和半开区间 `[startIndex,endIndex)`。映射函数按区间重叠选择 segment，不重新搜索 `source.text`，因此重复文字仍映射到正确位置。

相关块的框取最小联合矩形。OCR 置信度采用相关块最低值，作为保守来源置信度；解析置信等级仍独立保存在 `ExtractedField`。任何相关块被人工修正时，证据标记 `containsManualCorrection`，但原始 OCR 分数不被提高。无来源、越界或忽略块返回空证据。

用户手工编辑事件字段后，字段原始自动提取 `source` 不变，因此仍能查看原图证据，同时 UI 明确显示事件字段已手工修改。

## 多事件候选证据

`mapCandidateToOcrEvidence` 同时生成候选整体证据和各字段证据。候选整体直接使用 `CandidateSegment.source` 与 `OcrTextSegment` 求区间重叠；字段仍使用已映射回原 `combinedText` 的字段 `SourceSpan`。共享日期或地点字段因此会高亮真实标题块，候选整体则高亮自己的事件行。

点击候选标题显示候选整体区域，点击候选表单字段或解析依据显示字段区域。重复文字不会通过字符串搜索定位，所以同名活动仍指向各自 OCR 块。重新 OCR 会生成新 `OcrDocument` 并清除旧候选，避免旧索引映射到新文档。

## 课程表单元格证据

课程表二维识别不调用文本事件解析器，也不把图片坐标写入 `parseEventText`。`GridDetector` 从规范化图片 `ImageData` 检测自然坐标网格；`assignOcrBlocksToGridCells` 先以 OCR 块中心点归属单元格，再比较面积重叠。中心点与最大重叠冲突或多个重叠接近时产生 `COURSE_CELL_AMBIGUOUS_OCR`，同一块不会被复制到多个格。

每个 `GridCell` 保留 `ocrBlockIds`、自然坐标 `bbox`、`originalText`、可编辑 `text` 和 OCR 置信度。中文相邻块不强加空格，视觉换行保留为换行。用户编辑只修改 `text` 和 `manuallyEdited`，不会覆盖 `originalText`、不会回写 `OcrBlock`，也不会重新执行 OCR。移动网格线会重新按几何关系分配块并使旧课程模板失效。

## 排班 assignment 证据

排班表复用同一 `GridCell` 和 OCR 分配结果，再由 `RosterCell` 记录人员、日期、assignment 或忽略等语义角色。`RosterPerson.sourceCellId`、`RosterDateColumn.sourceCellId` 和 `ShiftAssignment.sourceCellId` 都直接指向真实来源格，不通过搜索重复文字恢复位置。

点击桌面矩阵或手机人员详情中的 assignment 时，原图显示该格的 `ocrBlockIds` 与自然坐标框，编辑器同时显示不可变 `originalText`。手工修改班次代码只更新 `RosterCell.text` 和 `manuallyEdited`；原 OCR 文本、OCR 置信度和几何证据保持不变。移动网格会重新分配证据并清除旧人员/日期映射与 occurrence，避免旧格引用覆盖新结构。
