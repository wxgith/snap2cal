import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const port = 4199;
const origin = `http://127.0.0.1:${port}`;
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");

function stopServer(server) {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    killer.unref();
  } else server.kill("SIGTERM");
}

async function waitForServer(server) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (server.exitCode !== null) throw new Error("Schedule verification server exited early.");
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Vite is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for schedule verification server.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = spawn(
  process.execPath,
  [viteBin, "--mode", "e2e", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: root,
    env: { ...process.env, VITE_SNAP2CAL_MOCK_OCR: "true" },
    stdio: "ignore",
    windowsHide: true,
  },
);
server.unref();

let browser;
try {
  await waitForServer(server);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent('<canvas width="640" height="185"></canvas>');
  await page.locator("canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 640, 185);
    context.strokeStyle = "black";
    context.lineWidth = 2;
    for (const x of [2, 100, 280, 460, 638]) {
      context.beginPath();
      context.moveTo(x, 2);
      context.lineTo(x, 183);
      context.stroke();
    }
    for (const y of [2, 55, 120, 183]) {
      context.beginPath();
      context.moveTo(2, y);
      context.lineTo(638, y);
      context.stroke();
    }
    context.fillStyle = "black";
    context.font = "16px sans-serif";
    context.fillText("时间", 20, 32);
    context.fillText("周一", 170, 32);
    context.fillText("周二", 350, 32);
    context.fillText("周三", 530, 32);
    context.fillText("08:00-09:40", 5, 88);
    context.fillText("10:00-11:40", 5, 153);
    context.fillText("高等数学 1-4周", 130, 88);
    context.fillText("大学英语 双周", 490, 153);
  });
  const image = await page.locator("canvas").screenshot({ type: "png" });
  const externalRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin)
      externalRequests.push(url.href);
  });
  await page.goto(`${origin}/?mockOcr=schedule&realGrid=1`);
  await page.getByRole("button", { name: "课程表" }).click();
  await page.getByLabel("选择图片").setInputFiles({
    name: "generated-schedule.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByLabel("OCR 文本块 12").waitFor();
  const startedAt = performance.now();
  await page.getByRole("button", { name: "检测课程表" }).click();
  await page.getByTestId("schedule-grid-overlay").waitFor();
  const detectionMs = Math.round(performance.now() - startedAt);
  const horizontalCount = await page.locator('[aria-label^="水平网格线"]').count();
  const verticalCount = await page.locator('[aria-label^="垂直网格线"]').count();
  assert(horizontalCount === 4, `Expected 4 horizontal lines, received ${horizontalCount}.`);
  assert(verticalCount === 5, `Expected 5 vertical lines, received ${verticalCount}.`);
  const imageBounds = await page.getByTestId("image-preview").locator("img").boundingBox();
  const overlayBounds = await page.getByTestId("schedule-grid-overlay").boundingBox();
  assert(imageBounds && overlayBounds, "Image and grid overlay must both be visible.");
  assert(
    Math.abs(imageBounds.x - overlayBounds.x) < 3 && Math.abs(imageBounds.y - overlayBounds.y) < 3,
    "Grid overlay is not aligned with the normalized image.",
  );
  await page.getByRole("button", { name: "确认网格" }).click();
  await page.getByRole("button", { name: "确认表头和时间" }).click();
  await page.getByLabel("第一教学周的星期一日期").fill("2026-09-07");
  await page.getByLabel("本学期总周数").fill("4");
  await page.getByRole("button", { name: "生成课程模板与具体事件" }).click();
  const occurrenceCount = await page.getByRole("checkbox", { name: /^包含 / }).count();
  assert(occurrenceCount === 6, `Expected 6 course occurrences, received ${occurrenceCount}.`);
  const generationBenchmark = await page.evaluate(async () => {
    const { generateCourseOccurrences } = await import("/src/schedule-table/occurrences.ts");
    const field = (value) => ({
      value,
      confidence: "high",
      manuallyEdited: false,
      derivedFromDefault: false,
    });
    const weeks = Array.from({ length: 10 }, (_, index) => index + 1);
    const templates = Array.from({ length: 100 }, (_, index) => ({
      id: `benchmark-${index}`,
      sourceCellIds: [`cell-${index}`],
      weekday: "monday",
      startRowIndex: 1,
      endRowIndex: 1,
      title: field(`课程 ${index}`),
      location: field(""),
      teacher: field(""),
      description: field(""),
      startTime: field("08:00"),
      endTime: field("09:00"),
      weekPattern: {
        kind: "explicit",
        weeks,
        derivedFromDefault: false,
        manuallyEdited: false,
      },
      selectedForExport: true,
      manuallyConfirmed: true,
      manuallyEdited: false,
      warnings: [],
    }));
    const startedAt = performance.now();
    const result = generateCourseOccurrences(templates, {
      weekOneMonday: "2026-09-07",
      totalWeeks: 10,
      timeZone: "Asia/Shanghai",
      defaultReminderMinutes: null,
      defaultWeekPattern: {
        kind: "all",
        weeks,
        derivedFromDefault: false,
        manuallyEdited: false,
      },
    });
    return { count: result.occurrences.length, milliseconds: performance.now() - startedAt };
  });
  assert(
    generationBenchmark.count === 1000,
    `Expected benchmark to generate 1000 occurrences, received ${generationBenchmark.count}.`,
  );
  assert(
    externalRequests.length === 0,
    `Unexpected third-party requests: ${externalRequests.join(", ")}`,
  );
  console.log(
    `Real ProjectionGridDetector browser smoke passed: ${horizontalCount} horizontal lines, ${verticalCount} vertical lines, ${occurrenceCount} preview occurrences, ${detectionMs} ms detection, 1000 occurrences in ${generationBenchmark.milliseconds.toFixed(1)} ms, zero third-party requests.`,
  );
} finally {
  if (browser) await browser.close();
  stopServer(server);
}
