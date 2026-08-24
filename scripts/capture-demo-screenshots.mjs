import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { formatBytes, isMainModule, REPOSITORY_ROOT, sha256File } from "./lib/fs-utils.mjs";
import {
  findAvailablePort,
  spawnNode,
  stopProcess,
  viteBin,
  waitForUrl,
} from "./lib/process-utils.mjs";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lines(value) {
  return escapeHtml(value).replaceAll("\\n", "<br>");
}

async function renderFixture(page, { width, height, content, output }) {
  await page.setViewportSize({ width, height });
  await page.setContent(`
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
          body { background: #f3f5f2; color: #17251f; font-family: Arial, "Microsoft YaHei", sans-serif; }
          #fixture { width: ${width}px; height: ${height}px; overflow: hidden; background: #fff; }
          .event { height: 100%; padding: 24px 30px; border: 2px solid #1f5b46; }
          .event h1 { margin: 0 0 18px; font-size: 25px; }
          .event p { margin: 10px 0; font-size: 20px; line-height: 1.35; }
          .event .label { color: #527064; font-size: 14px; font-weight: 700; }
          .list { height: 100%; padding: 20px 26px; border: 2px solid #1f5b46; }
          .list h1 { margin: 0 0 13px; font-size: 22px; }
          .list p { margin: 10px 0; padding: 8px 12px; border-left: 4px solid #6c9b87; background: #f3f7f4; font-size: 19px; }
          table { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
          caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
          th, td { border: 2px solid #17251f; padding: 5px; text-align: center; vertical-align: middle; white-space: normal; }
          th { background: #e8f0eb; font-size: 15px; }
          td { font-size: 14px; line-height: 1.25; }
          .timetable th:first-child, .timetable td:first-child { width: 100px; }
          .roster th:first-child, .roster td:first-child { width: 120px; background: #edf3ef; font-weight: 700; }
        </style>
      </head>
      <body><div id="fixture">${content}</div></body>
    </html>
  `);
  await page.locator("#fixture").screenshot({ path: output, type: "png", animations: "disabled" });
}

async function createSourceImages(browser, data, publicDemoPath) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    locale: data.locale,
    timezoneId: data.timeZone,
  });
  const page = await context.newPage();
  const single = data.singleEvent;
  await renderFixture(page, {
    width: 640,
    height: 260,
    output: path.join(publicDemoPath, "single-event.png"),
    content: `<article class="event"><span class="label">合成事件示例</span><h1>${escapeHtml(single.title)}</h1><p>${escapeHtml(single.date)} ${escapeHtml(single.time)}</p><p>地点：${escapeHtml(single.location)}</p><p>${escapeHtml(single.reminder)}</p></article>`,
  });
  await renderFixture(page, {
    width: 640,
    height: 260,
    output: path.join(publicDemoPath, "multi-event.png"),
    content: `<article class="list"><span class="label">合成多事件示例</span><h1>${escapeHtml(data.multipleEvents.date)}</h1>${data.multipleEvents.items.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</article>`,
  });

  const timetable = data.timetable;
  await renderFixture(page, {
    width: 640,
    height: 185,
    output: path.join(publicDemoPath, "timetable.png"),
    content: `<table class="timetable"><caption>${escapeHtml(timetable.title)}</caption><thead><tr>${timetable.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${timetable.rows.map((row) => `<tr>${row.map((cell) => `<td>${lines(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
  });

  const roster = data.shiftRoster;
  await renderFixture(page, {
    width: 600,
    height: 180,
    output: path.join(publicDemoPath, "shift-roster.png"),
    content: `<table class="roster"><caption>${escapeHtml(roster.title)}</caption><thead><tr>${roster.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${roster.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
  });
  await context.close();
}

async function hideMotion(page) {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
  });
}

async function configureRosterMapping(page, imagePath) {
  await page.getByRole("button", { name: "排班表" }).click();
  await page.getByLabel("选择图片").setInputFiles(imagePath);
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByLabel("OCR 文本块 15").waitFor();
  await page.getByRole("button", { name: "检测排班表" }).click();
  await page.getByTestId("roster-grid-overlay").waitFor();
  await page.getByRole("button", { name: "确认网格" }).click();
  await page.getByLabel("排班年份").fill("2026");
  await page.getByLabel("排班月份").fill("9");
  await page.getByRole("button", { name: "确认人员和日期" }).click();
}

async function createApplicationScreenshots(
  browser,
  data,
  root,
  publicDemoPath,
  imagesPath,
  origin,
) {
  const context = await browser.newContext({
    acceptDownloads: true,
    deviceScaleFactor: 1,
    locale: data.locale,
    timezoneId: data.timeZone,
    viewport: { width: 1280, height: 1000 },
  });
  const page = await context.newPage();

  await page.goto(origin);
  await hideMotion(page);
  const single = data.singleEvent;
  await page
    .getByLabel("活动文本")
    .fill(
      `${single.date}${single.time}，在${single.location}开${single.title}，${single.reminder}`,
    );
  await page.getByRole("button", { name: "解析事件" }).click();
  await page.getByLabel("事件标题").waitFor();
  await page.locator('section[aria-labelledby="editor-title"]').screenshot({
    path: path.join(imagesPath, "text-event-result.png"),
    type: "png",
    animations: "disabled",
  });

  await page.goto(`${origin}/?mockOcr=multi`);
  await hideMotion(page);
  await page.getByRole("button", { name: "图片识别" }).click();
  await page.getByLabel("选择图片").setInputFiles(path.join(publicDemoPath, "multi-event.png"));
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByLabel("OCR 文本块 4").waitFor();
  await page.getByRole("button", { name: "解析事件" }).click();
  await page.getByRole("heading", { name: "发现 3 个事件候选" }).waitFor();
  await page.getByRole("button", { name: "查看候选 2 原图证据" }).click();
  await page.getByLabel("候选 2 开始时间").click();
  await page.locator('section[aria-labelledby="image-title"]').screenshot({
    path: path.join(imagesPath, "ocr-evidence.png"),
    type: "png",
    animations: "disabled",
  });

  await page.goto(`${origin}/?mockOcr=schedule`);
  await hideMotion(page);
  await page.getByRole("button", { name: "课程表" }).click();
  await page.getByLabel("选择图片").setInputFiles(path.join(publicDemoPath, "timetable.png"));
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByLabel("OCR 文本块 12").waitFor();
  await page.getByRole("button", { name: "检测课程表" }).click();
  await page.getByTestId("schedule-grid-overlay").waitFor();
  await page.locator('section[aria-labelledby="schedule-grid-title"]').screenshot({
    path: path.join(imagesPath, "timetable-grid.png"),
    type: "png",
    animations: "disabled",
  });

  await page.goto(`${origin}/?mockOcr=roster`);
  await hideMotion(page);
  await configureRosterMapping(page, path.join(publicDemoPath, "shift-roster.png"));
  await page.locator('section[aria-labelledby="roster-review-title"]').screenshot({
    path: path.join(imagesPath, "shift-roster-matrix.png"),
    type: "png",
    animations: "disabled",
  });
  await context.close();

  const mobileContext = await browser.newContext({
    deviceScaleFactor: 1,
    locale: data.locale,
    timezoneId: data.timeZone,
    viewport: { width: 390, height: 844 },
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`${origin}/?mockOcr=roster`);
  await hideMotion(mobile);
  await configureRosterMapping(mobile, path.join(publicDemoPath, "shift-roster.png"));
  await mobile.locator(".roster-mobile-assignment").first().click();
  await mobile.locator('section[aria-labelledby="roster-review-title"]').screenshot({
    path: path.join(imagesPath, "shift-roster-mobile-390.png"),
    type: "png",
    animations: "disabled",
  });
  const overflow = await mobile.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth >
      globalThis.document.documentElement.clientWidth + 1,
  );
  if (overflow) throw new Error("Generated 390px roster state has page-level horizontal overflow.");
  await mobileContext.close();
}

export async function captureDemoScreenshots(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const data = JSON.parse(
    await readFile(path.join(root, "fixtures", "public-demo", "demo-data.json"), "utf8"),
  );
  if (data.synthetic !== true) throw new Error("Public demo data must be marked synthetic.");
  const publicDemoPath = path.join(root, "public", "demo");
  const imagesPath = path.join(root, "docs", "images");
  await mkdir(publicDemoPath, { recursive: true });
  await mkdir(imagesPath, { recursive: true });

  const browser = await chromium.launch();
  let server;
  try {
    await createSourceImages(browser, data, publicDemoPath);
    const port = await findAvailablePort();
    const origin = `http://127.0.0.1:${port}`;
    server = spawnNode(
      viteBin(root),
      ["--mode", "e2e", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { cwd: root, env: { ...process.env, VITE_SNAP2CAL_MOCK_OCR: "true" } },
    );
    await waitForUrl(origin, server);
    await createApplicationScreenshots(browser, data, root, publicDemoPath, imagesPath, origin);
  } finally {
    if (server) await stopProcess(server);
    await browser.close();
  }

  const publicFiles = ["single-event.png", "multi-event.png", "timetable.png", "shift-roster.png"];
  const documentationFiles = [
    "text-event-result.png",
    "ocr-evidence.png",
    "timetable-grid.png",
    "shift-roster-matrix.png",
    "shift-roster-mobile-390.png",
  ];
  const entries = [];
  for (const name of publicFiles) {
    const file = path.join(publicDemoPath, name);
    entries.push({ name, bytes: (await stat(file)).size, sha256: await sha256File(file) });
  }
  await writeFile(
    path.join(publicDemoPath, "manifest.json"),
    `${JSON.stringify(
      {
        synthetic: true,
        generatedBy: "npm run capture:demo",
        notice: data.notice,
        files: entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const allFiles = [
    ...entries.map((entry) => ({
      path: path.join(publicDemoPath, entry.name),
      bytes: entry.bytes,
    })),
    ...(await Promise.all(
      documentationFiles.map(async (name) => {
        const file = path.join(imagesPath, name);
        return { path: file, bytes: (await stat(file)).size };
      }),
    )),
  ];
  const totalBytes = allFiles.reduce((sum, file) => sum + file.bytes, 0);
  console.log(
    `Generated ${allFiles.length} synthetic PNG files (${formatBytes(totalBytes)} total) with fixed locale, timezone, and viewports.`,
  );
  return { files: allFiles, totalBytes };
}

if (isMainModule(import.meta.url)) {
  try {
    await captureDemoScreenshots();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
