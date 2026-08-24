import path from "node:path";
import { chromium, firefox, webkit } from "@playwright/test";
import { isMainModule, reportValidation, REPOSITORY_ROOT } from "./lib/fs-utils.mjs";
import {
  findAvailablePort,
  spawnNode,
  stopProcess,
  viteBin,
  waitForUrl,
} from "./lib/process-utils.mjs";

const BROWSERS = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit],
];

async function runBrowserSmoke(name, browserType, origin) {
  const browser = await browserType.launch();
  const failures = [];
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) },
      });
    });
    const page = await context.newPage();
    const externalOrigins = [];
    const responseFailures = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin)
        externalOrigins.push(url.origin);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin && response.status() >= 400)
        responseFailures.push(`${response.status()} ${url.pathname}`);
    });
    page.on("pageerror", (error) => failures.push(`Page error: ${error.message.slice(0, 180)}`));

    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Snap2Cal" }).waitFor();
    await page.getByLabel("活动文本").fill("2026年9月8日上午9点，在示例会议室开项目评审会");
    await page.getByRole("button", { name: "解析事件" }).click();
    await page.getByLabel("事件标题").waitFor();
    await page.getByRole("button", { name: "复制事件摘要" }).click();
    await page.getByText("无法访问剪贴板，请手工复制事件信息。").waitFor();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 ICS" }).click();
    await downloadPromise;

    await page.getByRole("button", { name: "课程表" }).click();
    await page.getByRole("heading", { name: "检测并校正网格" }).waitFor();
    await page.getByRole("button", { name: "排班表" }).click();
    await page.getByRole("heading", { name: "检测并校正排班网格" }).waitFor();
    await page.getByRole("button", { name: "图片识别" }).click();
    await page.getByRole("heading", { name: "本地图片识别" }).waitFor();

    const resources = await page.evaluate(async () => {
      const paths = [
        "/ocr/worker.min.js",
        "/ocr/core/tesseract-core.wasm",
        "/ocr/lang/chi_sim.traineddata.gz",
        "/ocr/lang/eng.traineddata.gz",
        "/demo/single-event.png",
      ];
      const fetched = [];
      for (const item of paths) {
        const response = await fetch(item);
        fetched.push({ item, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength });
      }
      const workerLoaded = await new Promise((resolve, reject) => {
        const worker = new globalThis.Worker("/ocr/worker.min.js");
        const timer = globalThis.setTimeout(() => {
          worker.terminate();
          resolve(true);
        }, 150);
        worker.onerror = () => {
          globalThis.clearTimeout(timer);
          worker.terminate();
          reject(new Error("Worker resource failed to load"));
        };
      });
      return { fetched, workerLoaded };
    });
    for (const resource of resources.fetched) {
      if (!resource.ok || resource.bytes === 0) failures.push(`Resource failed: ${resource.item}`);
    }
    if (!resources.workerLoaded) failures.push("Worker did not load.");

    const desktopOverflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth >
        globalThis.document.documentElement.clientWidth + 1,
    );
    if (desktopOverflow) failures.push("1280px viewport has page-level horizontal overflow.");

    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(origin);
    await mobile.getByRole("button", { name: "排班表" }).click();
    await mobile.getByRole("heading", { name: "检测并校正排班网格" }).waitFor();
    const mobileOverflow = await mobile.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth >
        globalThis.document.documentElement.clientWidth + 1,
    );
    if (mobileOverflow) failures.push("390px viewport has page-level horizontal overflow.");

    if (externalOrigins.length)
      failures.push(`Third-party origins: ${[...new Set(externalOrigins)].join(", ")}`);
    if (responseFailures.length)
      failures.push(`Failed responses: ${[...new Set(responseFailures)].join(", ")}`);
    await context.close();
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`${name}: ${[...new Set(failures)].join(" | ")}`);
  return `${name}: text, download, clipboard fallback, dynamic modules, resources, 1280px and 390px passed`;
}

export async function runCrossBrowserSmoke(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawnNode(
    viteBin(root),
    ["--mode", "e2e", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: root,
      env: { ...process.env, VITE_SNAP2CAL_MOCK_OCR: "true" },
    },
  );
  const errors = [];
  const summaries = [];
  try {
    await waitForUrl(origin, server);
    for (const [name, browserType] of BROWSERS) {
      try {
        summaries.push(await runBrowserSmoke(name, browserType, origin));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    await stopProcess(server);
  }
  return { errors, warnings: [], blockers: [], summaries };
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await runCrossBrowserSmoke();
    if (
      !reportValidation("Cross-browser smoke", result, {
        summary: result.summaries.join("\n"),
      })
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
