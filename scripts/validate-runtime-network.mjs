import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { JSDOM } from "jsdom";
import { isMainModule, pathExists, reportValidation, REPOSITORY_ROOT } from "./lib/fs-utils.mjs";
import { findAvailablePort, spawnNode, stopProcess, waitForUrl } from "./lib/process-utils.mjs";

async function builtBasePath(indexPath) {
  const dom = new JSDOM(await readFile(indexPath, "utf8"));
  const source = dom.window.document
    .querySelector('script[type="module"][src]')
    ?.getAttribute("src");
  dom.window.close();
  if (!source) throw new Error("Could not determine the built base path from dist/index.html.");
  const pathname = new URL(source, "https://snap2cal.invalid/").pathname;
  const assets = pathname.indexOf("assets/");
  return assets >= 0 ? pathname.slice(0, assets) : "/";
}

export async function validateRuntimeNetwork(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const distPath = path.resolve(options.distPath ?? path.join(root, "dist"));
  const indexPath = path.join(distPath, "index.html");
  const errors = [];
  const warnings = [];
  const blockers = [];
  if (!(await pathExists(indexPath)))
    return { errors: ["dist/index.html is missing."], warnings, blockers, requests: [] };

  const base = options.base ?? (await builtBasePath(indexPath));
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawnNode(
    path.join(root, "scripts", "serve-static.mjs"),
    ["--root", distPath, "--port", String(port), "--base", base],
    { cwd: root },
  );
  let browser;
  const requests = [];
  try {
    await waitForUrl(`${origin}${base}`, server);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const external = [];
    const failed = [];
    const consoleErrors = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin !== origin)
        external.push({ origin: url.origin, type: request.resourceType() });
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === origin)
        requests.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
      if (url.origin === origin && response.status() >= 400)
        failed.push(`${response.status()} ${url.pathname}`);
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      failed.push(`${url.pathname} (${request.failure()?.errorText ?? "request failed"})`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 160));
    });

    await page.goto(`${origin}${base}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Snap2Cal" }).waitFor();
    await page.getByLabel("活动文本").fill("2026年9月8日上午9点，在示例会议室开项目评审会");
    await page.getByRole("button", { name: "解析事件" }).click();
    await page.getByLabel("事件标题").waitFor();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 ICS" }).click();
    await downloadPromise;

    await page.getByRole("button", { name: "图片识别" }).click();
    await page.getByRole("heading", { name: "本地图片识别" }).waitFor();
    await page.getByRole("button", { name: "课程表" }).click();
    await page.getByRole("heading", { name: "检测并校正网格" }).waitFor();
    await page.getByRole("button", { name: "排班表" }).click();
    await page.getByRole("heading", { name: "检测并校正排班网格" }).waitFor();

    const resourceResult = await page.evaluate(async (basePath) => {
      const paths = [
        "ocr/worker.min.js",
        "ocr/core/tesseract-core.wasm",
        "ocr/lang/chi_sim.traineddata.gz",
        "ocr/lang/eng.traineddata.gz",
        "demo/single-event.png",
      ];
      const fetched = [];
      for (const item of paths) {
        const response = await fetch(`${basePath}${item}`);
        const bytes = (await response.arrayBuffer()).byteLength;
        fetched.push({ item, ok: response.ok, bytes });
      }
      const workerLoaded = await new Promise((resolve, reject) => {
        const worker = new globalThis.Worker(`${basePath}ocr/worker.min.js`);
        const timer = globalThis.setTimeout(() => {
          worker.terminate();
          resolve(true);
        }, 150);
        worker.onerror = () => {
          globalThis.clearTimeout(timer);
          worker.terminate();
          reject(new Error("OCR Worker script failed to load."));
        };
      });
      return { fetched, workerLoaded };
    }, base);

    for (const resource of resourceResult.fetched) {
      if (!resource.ok || resource.bytes === 0)
        errors.push(`Runtime resource failed: ${resource.item}.`);
    }
    if (!resourceResult.workerLoaded) errors.push("OCR Worker did not load in a real browser.");
    if (external.length)
      errors.push(
        `Runtime made ${external.length} third-party request(s): ${[...new Set(external.map((item) => item.origin))].join(", ")}.`,
      );
    if (failed.length) errors.push(`Runtime requests failed: ${[...new Set(failed)].join(", ")}.`);
    if (consoleErrors.length)
      errors.push(
        `Browser console reported ${consoleErrors.length} error(s): ${consoleErrors.join(" | ")}.`,
      );
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (browser) await browser.close();
    await stopProcess(server);
  }

  errors.sort((left, right) => left.localeCompare(right, "en"));
  return { errors, warnings, blockers, requests };
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await validateRuntimeNetwork();
    const unique = new Set(result.requests.map((request) => `${request.status} ${request.path}`));
    if (
      !reportValidation("Runtime network validation", result, {
        summary: `Observed ${result.requests.length} same-origin responses across ${unique.size} unique path/status pairs and zero allowed third-party origins.`,
      })
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
