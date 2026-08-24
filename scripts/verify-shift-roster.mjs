import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const port = 4200;
const origin = `http://127.0.0.1:${port}`;
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${basename(command)} ${args.join(" ")} exited with code ${code}.`));
    });
  });
}

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
    if (server.exitCode !== null) throw new Error("Shift-roster verification server exited early.");
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Vite is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for shift-roster verification server.");
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else files.push(path);
  }
  return files;
}

async function buildAndAuditProduction() {
  const productionEnvironment = { ...process.env };
  delete productionEnvironment.VITE_SNAP2CAL_MOCK_OCR;
  await run(process.execPath, [tscBin, "-b"], { env: productionEnvironment });
  await run(process.execPath, [viteBin, "build"], { env: productionEnvironment });

  const JavaScriptFiles = (await collectFiles(join(root, "dist"))).filter((path) =>
    path.endsWith(".js"),
  );
  assert(
    JavaScriptFiles.some((path) => basename(path).startsWith("ShiftRosterWorkspace-")),
    "Production build did not create a lazy shift-roster chunk.",
  );
  const productionCode = (
    await Promise.all(JavaScriptFiles.map((path) => readFile(path, "utf8")))
  ).join("\n");
  for (const identifier of [
    "MockRoster",
    "MOCK_ROSTER",
    "mockOcr",
    "MockGridDetector",
    "MockOcrAdapter",
  ])
    assert(!productionCode.includes(identifier), `Production bundle contains ${identifier}.`);
  return JavaScriptFiles.map((path) => basename(path));
}

async function makeRosterFixture(browser) {
  const page = await browser.newPage({ viewport: { width: 640, height: 220 } });
  try {
    await page.setContent('<canvas width="600" height="180"></canvas>');
    await page.locator("canvas").evaluate((canvas) => {
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, 600, 180);
      context.strokeStyle = "#111";
      context.lineWidth = 2;
      for (const x of [1, 120, 240, 360, 480, 599]) {
        context.beginPath();
        context.moveTo(x, 1);
        context.lineTo(x, 179);
        context.stroke();
      }
      for (const y of [1, 60, 120, 179]) {
        context.beginPath();
        context.moveTo(1, y);
        context.lineTo(599, y);
        context.stroke();
      }
    });
    return await page.locator("canvas").screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

async function configureDefinitions(page) {
  await page.getByLabel("班次 1 名称").fill("早班");
  await page.getByLabel("班次 1 开始时间").fill("08:00");
  await page.getByLabel("班次 1 结束时间").fill("16:00");
  await page.getByRole("button", { name: "确认班次定义" }).nth(0).click();

  await page.getByLabel("班次 2 名称").fill("夜班");
  await page.getByLabel("班次 2 开始时间").fill("20:00");
  await page.getByLabel("班次 2 结束时间").fill("08:00");
  await page.getByLabel("班次 2 跨午夜").check();
  await page.getByRole("button", { name: "确认班次定义" }).nth(1).click();

  await page.getByLabel("班次 3 类型").selectOption("skip");
  await page.getByLabel("班次 3 名称").fill("休息");
  await page.getByRole("button", { name: "确认班次定义" }).nth(2).click();
}

async function benchmarkRoster(page) {
  return page.evaluate(async () => {
    const {
      buildShiftAssignments,
      buildShiftCodeCatalog,
      detectShiftConflicts,
      generateShiftOccurrences,
    } = await import("/src/shift-roster/index.ts");
    const people = Array.from({ length: 100 }, (_, index) => ({
      id: `person-${index}`,
      rowIndex: index + 1,
      sourceCellId: `person-cell-${index}`,
      originalText: `Person ${index}`,
      displayName: `Person ${index}`,
      selectedForExport: true,
      manuallyEdited: false,
      warnings: [],
    }));
    const dates = Array.from({ length: 31 }, (_, index) => ({
      id: `date-${index}`,
      columnIndex: index + 1,
      sourceCellId: `date-cell-${index}`,
      originalText: String(index + 1),
      date: `2027-01-${String(index + 1).padStart(2, "0")}`,
      derivedFromYearMonth: true,
      manuallyEdited: false,
      warnings: [],
    }));
    const cells = people.flatMap((person) =>
      dates.map((date) => ({
        gridCellId: `cell-${person.rowIndex}-${date.columnIndex}`,
        rowIndex: person.rowIndex,
        columnIndex: date.columnIndex,
        bbox: { x: date.columnIndex, y: person.rowIndex, width: 1, height: 1 },
        ocrBlockIds: [],
        confidence: 0.99,
        role: "assignment",
        originalText: "N",
        text: "N",
        manuallyEdited: false,
        warnings: [],
      })),
    );
    const definitions = [
      {
        id: "night",
        primaryCode: "N",
        aliases: [],
        displayName: "Night shift",
        kind: "timed",
        startTime: "20:00",
        endTime: "08:00",
        crossesMidnight: true,
        location: "",
        description: "",
        reminderMinutes: null,
        manuallyConfirmed: true,
        warnings: [],
      },
    ];
    const assignmentStartedAt = performance.now();
    const assignmentResult = buildShiftAssignments(cells, people, dates, definitions);
    const assignmentMilliseconds = performance.now() - assignmentStartedAt;
    const catalog = buildShiftCodeCatalog(assignmentResult.assignments, cells, people, dates);

    const occurrenceStartedAt = performance.now();
    const occurrenceResult = generateShiftOccurrences(
      assignmentResult.assignments,
      people,
      dates,
      definitions,
      {
        rosterYear: 2027,
        rosterMonth: 1,
        timeZone: "Asia/Shanghai",
        exportMode: "team",
        includePersonNameInTitle: true,
        defaultReminderMinutes: null,
      },
    );
    const occurrenceMilliseconds = performance.now() - occurrenceStartedAt;
    const conflictStartedAt = performance.now();
    const conflictChecked = detectShiftConflicts(occurrenceResult.occurrences);
    const conflictMilliseconds = performance.now() - conflictStartedAt;
    return {
      assignmentCount: assignmentResult.assignments.length,
      occurrenceCount: occurrenceResult.occurrences.length,
      catalogCount: catalog.length,
      lastEndDate: occurrenceResult.occurrences.at(-1)?.endDate,
      conflictCheckedCount: conflictChecked.length,
      assignmentMilliseconds,
      occurrenceMilliseconds,
      conflictMilliseconds,
    };
  });
}

const productionChunks = await buildAndAuditProduction();
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
  const image = await makeRosterFixture(browser);
  const page = await browser.newPage({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1280, height: 900 },
  });
  const requestedUrls = [];
  const externalRequests = [];
  page.on("request", (request) => {
    requestedUrls.push(request.url());
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin)
      externalRequests.push(url.href);
  });

  await page.goto(origin);
  assert(
    !requestedUrls.some((url) => url.includes("ShiftRosterWorkspace")),
    "Shift-roster module loaded before the user selected roster mode.",
  );
  await page.getByRole("button", { name: "排班表" }).click();
  await page.getByRole("heading", { name: "导入排班表截图" }).waitFor();
  assert(
    requestedUrls.some((url) => url.includes("ShiftRosterWorkspace")),
    "Shift-roster module was not requested after selecting roster mode.",
  );

  await page.goto(`${origin}/?mockOcr=roster&realGrid=1`);
  await page.getByRole("button", { name: "排班表" }).click();
  await page.getByLabel("选择图片").setInputFiles({
    name: "generated-roster.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByLabel("OCR 文本块 15").waitFor();
  const detectionStartedAt = performance.now();
  await page.getByRole("button", { name: "检测排班表" }).click();
  await page.getByTestId("roster-grid-overlay").waitFor();
  const detectionMilliseconds = performance.now() - detectionStartedAt;
  const horizontalCount = await page.locator('[aria-label^="水平网格线"]').count();
  const verticalCount = await page.locator('[aria-label^="垂直网格线"]').count();
  assert(horizontalCount === 4, `Expected 4 horizontal lines, received ${horizontalCount}.`);
  assert(verticalCount === 6, `Expected 6 vertical lines, received ${verticalCount}.`);

  await page.getByRole("button", { name: "确认网格" }).click();
  await page.getByLabel("排班年份").fill("2026");
  await page.getByLabel("排班月份").fill("9");
  await page.getByRole("button", { name: "确认人员和日期" }).click();
  await page.getByRole("button", { name: "张三 2026-09-01 班次 A" }).waitFor();
  const primaryCodes = await page
    .locator('[aria-label$="主代码"]')
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  assert(
    primaryCodes.join(",") === "A,N,OFF",
    `Unexpected shift catalog: ${primaryCodes.join(",")}.`,
  );
  await page.getByRole("button", { name: "张三 2026-09-01 班次 A" }).click();
  assert(
    (await page.locator('[data-testid="ocr-box"][data-evidence="true"]').count()) === 1,
    "Assignment did not map back to exactly one OCR evidence block.",
  );
  await page.getByText("OCR 原文：A").waitFor();

  await configureDefinitions(page);
  await page.getByRole("button", { name: "生成班次事件" }).click();
  const occurrenceCount = await page.getByRole("checkbox", { name: /^导出 / }).count();
  assert(occurrenceCount === 6, `Expected 6 preview occurrences, received ${occurrenceCount}.`);
  await page.getByText("20:00-次日 08:00").first().waitFor();

  const personalDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载个人排班 ICS" }).click();
  const personalDownload = await personalDownloadPromise;
  const personalIcs = await readFile(await personalDownload.path(), "utf8");
  assert(
    (personalIcs.match(/BEGIN:VEVENT/g) ?? []).length === 3,
    "Personal ICS must contain 3 VEVENTs.",
  );
  assert(
    personalIcs.includes("DTSTART;TZID=Asia/Shanghai:20260902T200000") &&
      personalIcs.includes("DTEND;TZID=Asia/Shanghai:20260903T080000"),
    "Personal ICS has an incorrect cross-midnight occurrence.",
  );

  const teamDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载团队排班 ICS" }).click();
  const teamDownload = await teamDownloadPromise;
  const teamIcs = await readFile(await teamDownload.path(), "utf8");
  assert(
    (teamIcs.match(/BEGIN:VCALENDAR/g) ?? []).length === 1,
    "Team ICS must contain one VCALENDAR.",
  );
  assert((teamIcs.match(/BEGIN:VEVENT/g) ?? []).length === 6, "Team ICS must contain 6 VEVENTs.");
  assert(teamIcs.includes("SUMMARY:张三 · "), "Team ICS titles must include person names.");
  assert(!teamIcs.includes("SUMMARY:休息"), "Skip assignments must not generate VEVENTs.");
  assert(
    !personalIcs.includes("RRULE") && !teamIcs.includes("RRULE"),
    "Roster ICS must not use RRULE.",
  );

  const benchmark = await benchmarkRoster(page);
  assert(
    benchmark.assignmentCount === 3100,
    `Expected 3100 assignments, received ${benchmark.assignmentCount}.`,
  );
  assert(
    benchmark.occurrenceCount === 3100,
    `Expected 3100 occurrences, received ${benchmark.occurrenceCount}.`,
  );
  assert(
    benchmark.catalogCount === 1,
    `Expected one benchmark catalog code, received ${benchmark.catalogCount}.`,
  );
  assert(
    benchmark.lastEndDate === "2027-02-01",
    `Expected cross-month end date 2027-02-01, received ${benchmark.lastEndDate}.`,
  );
  assert(
    benchmark.conflictCheckedCount === 3100,
    "Conflict detection did not inspect all occurrences.",
  );
  assert(
    externalRequests.length === 0,
    `Unexpected third-party requests: ${externalRequests.join(", ")}`,
  );

  console.log(
    [
      `Shift-roster verification passed with lazy chunk ${productionChunks.find((name) => name.startsWith("ShiftRosterWorkspace-"))}.`,
      `Real ProjectionGridDetector: ${horizontalCount} horizontal lines, ${verticalCount} vertical lines in ${detectionMilliseconds.toFixed(1)} ms.`,
      `Browser flow: 15 OCR blocks, 2 people, 4 dates, 3 codes, 6 occurrences, personal/team ICS, zero third-party requests.`,
      `Benchmark: 3100 assignments in ${benchmark.assignmentMilliseconds.toFixed(1)} ms; 3100 occurrences in ${benchmark.occurrenceMilliseconds.toFixed(1)} ms; conflict detection in ${benchmark.conflictMilliseconds.toFixed(1)} ms.`,
      "Production bundle contains no Mock roster, OCR, or grid identifiers.",
    ].join("\n"),
  );
} finally {
  if (browser) await browser.close();
  stopServer(server);
}
