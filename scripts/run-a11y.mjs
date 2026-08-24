import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { isMainModule, reportValidation, REPOSITORY_ROOT } from "./lib/fs-utils.mjs";
import {
  findAvailablePort,
  spawnNode,
  stopProcess,
  viteBin,
  waitForUrl,
} from "./lib/process-utils.mjs";

async function seriousViolations(page, scenario) {
  const analysis = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return analysis.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map(
      (violation) =>
        `${scenario}: ${violation.id} (${violation.impact}) affected ${violation.nodes.length} node(s): ${violation.nodes
          .slice(0, 8)
          .map((node) => node.target.join(" > "))
          .join(", ")}`,
    );
}

export async function runAccessibilitySmoke(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawnNode(
    viteBin(root),
    ["--mode", "e2e", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, env: { ...process.env, VITE_SNAP2CAL_MOCK_OCR: "true" } },
  );
  const errors = [];
  let browser;
  let context;
  try {
    await waitForUrl(origin, server);
    browser = await chromium.launch();
    context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(origin);
    errors.push(...(await seriousViolations(page, "home")));

    await page.getByLabel("活动文本").fill("2026年9月8日上午9点，在示例会议室开项目评审会");
    await page.getByRole("button", { name: "解析事件" }).click();
    await page.getByLabel("事件标题").waitFor();
    errors.push(...(await seriousViolations(page, "text event result")));

    await page.goto(`${origin}/?mockOcr=multi`);
    await page.getByRole("button", { name: "图片识别" }).click();
    await page
      .getByLabel("选择图片")
      .setInputFiles(path.join(root, "public", "demo", "multi-event.png"));
    await page.getByRole("button", { name: "开始识别" }).click();
    await page.getByLabel("OCR 文本块 4").waitFor();
    await page.getByRole("button", { name: "解析事件" }).click();
    await page.getByRole("heading", { name: "发现 3 个事件候选" }).waitFor();
    errors.push(...(await seriousViolations(page, "OCR event result")));

    await page.goto(`${origin}/?mockOcr=schedule`);
    await page.getByRole("button", { name: "课程表" }).click();
    await page
      .getByLabel("选择图片")
      .setInputFiles(path.join(root, "public", "demo", "timetable.png"));
    await page.getByRole("button", { name: "开始识别" }).click();
    await page.getByLabel("OCR 文本块 12").waitFor();
    await page.getByRole("button", { name: "检测课程表" }).click();
    await page.getByTestId("schedule-grid-overlay").waitFor();
    errors.push(...(await seriousViolations(page, "timetable grid")));

    await page.goto(`${origin}/?mockOcr=roster`);
    await page.getByRole("button", { name: "排班表" }).click();
    await page
      .getByLabel("选择图片")
      .setInputFiles(path.join(root, "public", "demo", "shift-roster.png"));
    await page.getByRole("button", { name: "开始识别" }).click();
    await page.getByLabel("OCR 文本块 15").waitFor();
    await page.getByRole("button", { name: "检测排班表" }).click();
    await page.getByTestId("roster-grid-overlay").waitFor();
    errors.push(...(await seriousViolations(page, "shift-roster grid")));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    await stopProcess(server);
  }

  return { errors: [...new Set(errors)], warnings: [], blockers: [], scenarioCount: 5 };
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await runAccessibilitySmoke();
    if (
      !reportValidation("Accessibility smoke", result, {
        summary: `Checked ${result.scenarioCount} synthetic application states for serious and critical WCAG A/AA findings.`,
      })
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
