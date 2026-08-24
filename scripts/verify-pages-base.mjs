import { rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  isInside,
  isMainModule,
  pathExists,
  reportValidation,
  REPOSITORY_ROOT,
} from "./lib/fs-utils.mjs";
import {
  findAvailablePort,
  runCommand,
  spawnNode,
  stopProcess,
  viteBin,
  waitForUrl,
} from "./lib/process-utils.mjs";

const TEST_BASE = "/snap2cal-test/";

export async function verifyPagesBase(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const outputRoot = path.resolve(options.outputRoot ?? path.join(root, "artifacts", "pages-base"));
  const distPath = path.join(outputRoot, "dist");
  const errors = [];
  const warnings = [];
  const blockers = [];
  const requiredSourceAssets = [
    "public/ocr/worker.min.js",
    "public/ocr/core/tesseract-core.wasm",
    "public/ocr/lang/chi_sim.traineddata.gz",
    "public/ocr/lang/eng.traineddata.gz",
    "public/demo/single-event.png",
  ];
  for (const relative of requiredSourceAssets) {
    if (!(await pathExists(path.join(root, relative))))
      errors.push(`Required Pages source asset is missing: ${relative}.`);
  }
  if (errors.length) return { errors, warnings, blockers, requests: [] };
  if (!isInside(path.join(root, "artifacts"), outputRoot))
    return {
      errors: ["Pages test output must remain under artifacts/."],
      warnings,
      blockers,
      requests: [],
    };

  await rm(outputRoot, { recursive: true, force: true });
  await runCommand(
    process.execPath,
    [viteBin(root), "build", "--mode", "e2e", "--outDir", distPath, "--emptyOutDir"],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_BASE_PATH: TEST_BASE,
        VITE_SNAP2CAL_MOCK_OCR: "true",
      },
    },
  );

  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawnNode(
    path.join(root, "scripts", "serve-static.mjs"),
    ["--root", distPath, "--port", String(port), "--base", TEST_BASE],
    { cwd: root },
  );
  let browser;
  const requests = [];
  try {
    await waitForUrl(`${origin}${TEST_BASE}`, server);
    const rootResponse = await fetch(origin);
    if (rootResponse.status !== 404)
      errors.push(
        `Pages smoke server unexpectedly served the domain root with ${rootResponse.status}.`,
      );

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const external = [];
    const failures = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin !== origin) external.push(url.origin);
      else if (!url.pathname.startsWith(TEST_BASE))
        failures.push(`Request escaped Pages base: ${url.pathname}`);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== origin) return;
      requests.push({ path: url.pathname, status: response.status() });
      if (response.status() >= 400) failures.push(`${response.status()} ${url.pathname}`);
    });
    page.on("requestfailed", (request) => {
      failures.push(
        `${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "failed"}`,
      );
    });

    await page.goto(`${origin}${TEST_BASE}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Snap2Cal" }).waitFor();

    await page.getByRole("button", { name: "课程表" }).click();
    await page.getByRole("heading", { name: "检测并校正网格" }).waitFor();
    await page.getByRole("button", { name: "排班表" }).click();
    await page.getByRole("heading", { name: "检测并校正排班网格" }).waitFor();

    await page.getByRole("button", { name: "图片识别" }).click();
    await page
      .locator('section[aria-labelledby="image-title"]')
      .getByLabel("选择图片")
      .setInputFiles(path.join(root, "public", "demo", "single-event.png"));
    await page.getByRole("button", { name: "开始识别" }).click();
    await page.getByLabel("OCR 文本块 1").waitFor();
    await page.getByRole("button", { name: "解析事件" }).click();
    await page.getByLabel("事件标题").waitFor();

    const staticResources = await page.evaluate(async (basePath) => {
      const paths = [
        "ocr/worker.min.js",
        "ocr/core/tesseract-core.wasm",
        "ocr/lang/chi_sim.traineddata.gz",
        "ocr/lang/eng.traineddata.gz",
        "demo/single-event.png",
        "favicon.svg",
      ];
      const results = [];
      for (const item of paths) {
        const response = await fetch(`${basePath}${item}`);
        results.push({ item, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength });
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
          reject(new Error("Worker load failed under Pages base."));
        };
      });
      return { results, workerLoaded };
    }, TEST_BASE);

    for (const resource of staticResources.results) {
      if (!resource.ok || resource.bytes === 0)
        failures.push(`Static resource failed under Pages base: ${resource.item}`);
    }
    if (!staticResources.workerLoaded) failures.push("OCR Worker did not load under Pages base.");
    const paths = requests.map((request) => request.path);
    for (const expected of ["ScheduleTableWorkspace-", "ShiftRosterWorkspace-"]) {
      if (!paths.some((requestPath) => requestPath.includes(expected)))
        failures.push(`Dynamic ${expected} chunk was not requested.`);
    }
    if (!paths.some((requestPath) => /\/assets\/index-[^/]+\.js$/.test(requestPath)))
      failures.push("Main JavaScript was not requested under Pages base.");
    if (!paths.some((requestPath) => /\/assets\/index-[^/]+\.css$/.test(requestPath)))
      failures.push("Main CSS was not requested under Pages base.");
    if (external.length)
      failures.push(`Third-party origins requested: ${[...new Set(external)].join(", ")}`);
    errors.push(...failures);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (browser) await browser.close();
    await stopProcess(server);
  }

  const uniqueErrors = [...new Set(errors)].sort((left, right) => left.localeCompare(right, "en"));
  return { errors: uniqueErrors, warnings, blockers, requests };
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await verifyPagesBase();
    if (
      !reportValidation("Pages non-root base verification", result, {
        summary: `Observed ${result.requests.length} same-origin browser responses under ${TEST_BASE}.`,
      })
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
