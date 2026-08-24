import { gzipSync } from "node:zlib";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  directorySize,
  formatBytes,
  isMainModule,
  listFiles,
  pathExists,
  relativePath,
  reportValidation,
  REPOSITORY_ROOT,
} from "./lib/fs-utils.mjs";

const FORBIDDEN_MOCK_IDENTIFIERS = [
  "MockOcrAdapter",
  "MockGridDetector",
  "MockRoster",
  "MOCK_ROSTER",
  "mockOcr",
  "mockGrid",
  "testQuery",
  "PLAYWRIGHT",
  "E2E_ONLY",
];

const FORBIDDEN_RUNTIME_URLS = [
  "tessdata.projectnaptha.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
];

function addIssue(collection, message) {
  if (!collection.includes(message)) collection.push(message);
}

function chunkByPrefix(files, prefix) {
  return files.find((file) => path.basename(file).startsWith(`${prefix}-`) && file.endsWith(".js"));
}

function inferBasePath(document) {
  const moduleScript = document.querySelector('script[type="module"][src]');
  if (!moduleScript) return null;
  const source = moduleScript.getAttribute("src") ?? "";
  const url = new URL(source, "https://snap2cal.invalid/");
  const assetIndex = url.pathname.indexOf("assets/");
  return assetIndex >= 0
    ? url.pathname.slice(0, assetIndex)
    : url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
}

async function validateDocumentReferences(indexPath, distPath, errors) {
  const html = await readFile(indexPath, "utf8");
  if (html.includes("%BASE_URL%"))
    addIssue(errors, "dist/index.html contains unresolved %BASE_URL%.");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const basePath = inferBasePath(document);
  if (!basePath) {
    addIssue(errors, "dist/index.html has no module script with a source path.");
    return { html, basePath: null };
  }

  const references = [
    ...[...document.querySelectorAll("script[src]")].map((element) => element.getAttribute("src")),
    ...[...document.querySelectorAll("link[href]")].map((element) => element.getAttribute("href")),
    ...[...document.querySelectorAll("img[src]")].map((element) => element.getAttribute("src")),
  ].filter(Boolean);

  for (const reference of references) {
    const url = new URL(reference, "https://snap2cal.invalid/");
    if (url.origin !== "https://snap2cal.invalid") {
      addIssue(errors, `dist/index.html references an external asset origin (${url.origin}).`);
      continue;
    }
    if (!url.pathname.startsWith(basePath)) {
      addIssue(errors, `dist/index.html asset bypasses configured base path: ${url.pathname}`);
      continue;
    }
    const relative = decodeURIComponent(url.pathname.slice(basePath.length));
    if (!(await pathExists(path.join(distPath, relative))))
      addIssue(errors, `dist/index.html references missing asset ${relative}.`);
  }
  dom.window.close();
  return { html, basePath };
}

async function fileMetrics(file) {
  const data = await readFile(file);
  return { rawBytes: data.length, gzipBytes: gzipSync(data).length };
}

function checkBudget(name, metrics, budget, errors) {
  if (!metrics || !budget) return;
  if (metrics.rawBytes > budget.rawBytes)
    addIssue(errors, `${name} raw size ${metrics.rawBytes} exceeds budget ${budget.rawBytes}.`);
  if (metrics.gzipBytes > budget.gzipBytes)
    addIssue(errors, `${name} gzip size ${metrics.gzipBytes} exceeds budget ${budget.gzipBytes}.`);
}

export async function validateDist(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const distPath = path.resolve(options.distPath ?? path.join(root, "dist"));
  const budgetsPath = path.resolve(
    options.budgetsPath ?? path.join(root, "config", "bundle-budgets.json"),
  );
  const errors = [];
  const warnings = [];
  const blockers = [];
  const indexPath = path.join(distPath, "index.html");

  if (!(await pathExists(distPath))) {
    return { errors: ["dist directory is missing."], warnings, blockers, metrics: null };
  }
  if (!(await pathExists(indexPath))) {
    return { errors: ["dist/index.html is missing."], warnings, blockers, metrics: null };
  }

  let budgets;
  try {
    budgets = JSON.parse(await readFile(budgetsPath, "utf8"));
  } catch {
    addIssue(errors, `${relativePath(root, budgetsPath)} is missing or invalid.`);
    budgets = {};
  }

  const files = await listFiles(distPath);
  const relativeFiles = files.map((file) => relativePath(distPath, file));
  const JavaScriptFiles = files.filter((file) => file.endsWith(".js"));
  const appJavaScriptFiles = JavaScriptFiles.filter((file) =>
    relativePath(distPath, file).startsWith("assets/"),
  );

  await validateDocumentReferences(indexPath, distPath, errors);

  const requiredExact = [
    "ocr/worker.min.js",
    "ocr/lang/chi_sim.traineddata.gz",
    "ocr/lang/eng.traineddata.gz",
    "demo/single-event.png",
    "demo/multi-event.png",
    "demo/timetable.png",
    "demo/shift-roster.png",
    "favicon.svg",
  ];
  for (const relative of requiredExact) {
    if (!relativeFiles.includes(relative)) addIssue(errors, `dist is missing ${relative}.`);
  }
  if (!relativeFiles.some((file) => file.startsWith("ocr/core/") && file.endsWith(".wasm")))
    addIssue(errors, "dist is missing an OCR WASM core.");

  const chunkFiles = {
    main: chunkByPrefix(appJavaScriptFiles, "index"),
    scheduleTable: chunkByPrefix(appJavaScriptFiles, "ScheduleTableWorkspace"),
    shiftRoster: chunkByPrefix(appJavaScriptFiles, "ShiftRosterWorkspace"),
    ocrAdapter: chunkByPrefix(appJavaScriptFiles, "TesseractOcrAdapter"),
    projectionGrid: chunkByPrefix(appJavaScriptFiles, "ProjectionGridDetector"),
  };
  for (const [name, file] of Object.entries(chunkFiles)) {
    if (!file) addIssue(errors, `dist is missing the ${name} JavaScript chunk.`);
  }

  for (const file of [...JavaScriptFiles, indexPath]) {
    const text = await readFile(file, "utf8");
    const relative = relativePath(distPath, file);
    for (const identifier of FORBIDDEN_MOCK_IDENTIFIERS) {
      if (text.includes(identifier))
        addIssue(errors, `${relative} contains production-forbidden ${identifier}.`);
    }
    for (const origin of FORBIDDEN_RUNTIME_URLS) {
      if (text.includes(origin))
        addIssue(errors, `${relative} contains third-party runtime origin ${origin}.`);
    }
    if (/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(text))
      addIssue(errors, `${relative} contains a localhost URL.`);
    if (
      /[A-Za-z]:(?:[\\/]|\\\\)Users(?:[\\/]|\\\\)[^\\/\s]+(?:[\\/]|\\\\)|Documents[\\/]ChatGPT|\/home\/[^/\s]+\//i.test(
        text,
      )
    )
      addIssue(errors, `${relative} contains an absolute developer path.`);
  }

  const chunkMetrics = {};
  for (const [name, file] of Object.entries(chunkFiles)) {
    if (file) chunkMetrics[name] = await fileMetrics(file);
  }
  checkBudget("Main bundle", chunkMetrics.main, budgets.main, errors);
  checkBudget("Schedule-table bundle", chunkMetrics.scheduleTable, budgets.scheduleTable, errors);
  checkBudget("Shift-roster bundle", chunkMetrics.shiftRoster, budgets.shiftRoster, errors);
  checkBudget("OCR-adapter bundle", chunkMetrics.ocrAdapter, budgets.ocrAdapter, errors);

  const applicationJavaScriptRawBytes = (
    await Promise.all(appJavaScriptFiles.map((file) => stat(file)))
  ).reduce((sum, details) => sum + details.size, 0);
  const distBytes = await directorySize(distPath);
  const ocrPath = path.join(distPath, "ocr");
  const ocrBytes = (await pathExists(ocrPath)) ? await directorySize(ocrPath) : 0;
  const ocrFiles = files.filter((file) => relativePath(distPath, file).startsWith("ocr/"));
  const largestOcrFileBytes = ocrFiles.length
    ? Math.max(...(await Promise.all(ocrFiles.map(async (file) => (await stat(file)).size))))
    : 0;
  if (applicationJavaScriptRawBytes > (budgets.applicationJavaScriptRawBytes ?? Infinity))
    addIssue(
      errors,
      `Application JavaScript ${applicationJavaScriptRawBytes} exceeds budget ${budgets.applicationJavaScriptRawBytes}.`,
    );
  if (distBytes > (budgets.distBytes ?? Infinity))
    addIssue(errors, `Total dist size ${distBytes} exceeds budget ${budgets.distBytes}.`);
  if (ocrBytes > (budgets.ocrBytes ?? Infinity))
    addIssue(errors, `OCR asset size ${ocrBytes} exceeds budget ${budgets.ocrBytes}.`);
  if (largestOcrFileBytes > (budgets.largestOcrFileBytes ?? Infinity))
    addIssue(
      errors,
      `Largest OCR file ${largestOcrFileBytes} exceeds budget ${budgets.largestOcrFileBytes}.`,
    );

  const metrics = {
    chunks: chunkMetrics,
    applicationJavaScriptRawBytes,
    distBytes,
    ocrBytes,
    largestOcrFileBytes,
    fileCount: files.length,
  };
  for (const collection of [errors, warnings, blockers])
    collection.sort((a, b) => a.localeCompare(b, "en"));
  return { errors, warnings, blockers, metrics };
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await validateDist();
    const metrics = result.metrics;
    const summary = metrics
      ? `Dist: ${metrics.fileCount} files, ${formatBytes(metrics.distBytes)} total, ${formatBytes(metrics.ocrBytes)} OCR, ${formatBytes(metrics.applicationJavaScriptRawBytes)} application JavaScript.`
      : undefined;
    if (!reportValidation("Production dist validation", result, { summary })) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
