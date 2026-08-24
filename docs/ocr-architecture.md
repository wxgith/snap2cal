# OCR 架构

## 适配器边界

React 只依赖 `OcrAdapter.recognize(blob, options)` 与 `dispose()`。生产环境延迟导入 `TesseractOcrAdapter`，E2E 的 `e2e` Vite 模式延迟导入确定性 `MockOcrAdapter`；生产构建中不会根据 URL 或用户输入选择 Mock。

Tesseract.js 固定为 7.0.0，使用 Web Worker。语言为 `chi_sim` 和 `eng`，引擎原始 0–100 置信度除以 100 并限制到 0–1。适配器请求带坐标的 `blocks`，以 OCR 行构建稳定块。

## 同源资源

运行 `npm run prepare:ocr` 后资源位于 `public/ocr/`：

- `worker.min.js`
- `core/` 下 Tesseract.js-core 7.0.0 的 JS/WASM 变体
- `lang/chi_sim.traineddata.gz`
- `lang/eng.traineddata.gz`
- 含大小和 SHA-256 的 `manifest.json`

路径由 `import.meta.env.BASE_URL` 生成，兼容非根路径部署。适配器在创建 Worker 前读取同源 manifest；缺失时显示 `OCR_ASSETS_MISSING`。所有 worker/core/lang 路径均显式配置，禁止默认 CDN 回退；浏览器缓存策略为 `none`，不把语言数据写入 IndexedDB。

`prepare:ocr` 从已安装 npm 包复制引擎文件，并从 Tesseract.js 官方文档指定的 `tessdata.projectnaptha.com/4.0.0_fast` 下载语言数据。资源目录被 Git 忽略，需要在构建或部署前准备。

## 生命周期、进度与取消

OCR 模块在进入图片模式且用户开始识别前不会加载。任务拥有递增 ID 和 `AbortController`。取消、换图、删图或组件卸载会使任务 ID 失效、触发 abort 并调用 `worker.terminate()`；旧任务即使稍后返回也不能写入状态。下一次识别创建新 Worker。

进度区分加载引擎、加载语言、识别、整理结果和完成。初始化阶段的进度最高限制在对应阶段范围内，不显示虚假 100%。

## 测试与真实验证

普通单元、组件和 E2E 使用 `MockOcrAdapter`，不加载大型资源。`npm run verify:ocr` 校验所有已准备文件的长度和 SHA-256。真实浏览器冒烟步骤：

1. `npm run prepare:ocr && npm run dev`。
2. 打开开发者工具 Network，勾选 Preserve log 并清空记录。
3. 上传一张清晰的简体中文印刷截图并开始识别。
4. 确认 Worker 初始化、结果非空，且请求仅指向当前应用源的 `/ocr/`。
5. 校对文字、解析事件并下载 ICS。

真实 OCR 准确率不作为稳定 CI 断言。
