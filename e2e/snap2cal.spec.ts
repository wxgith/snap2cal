import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const E2E_ORIGIN = process.env.SNAP2CAL_E2E_URL ?? "http://127.0.0.1:4173";

async function configureRosterDefinitions(page: Page) {
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

async function openMockRoster(page: Page, query = "?mockOcr=roster") {
  await page.setContent(
    '<div style="width:600px;height:180px;box-sizing:border-box;background:white;border:2px solid #111">排班表测试图</div>',
  );
  const screenshot = await page.locator("div").screenshot({ type: "png" });
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "排班表" }).click();
  await page
    .getByLabel("选择图片")
    .setInputFiles({ name: "roster.png", mimeType: "image/png", buffer: screenshot });
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByLabel("OCR 文本块 15").waitFor();
  await page.getByRole("button", { name: "检测排班表" }).click();
  await page.getByTestId("roster-grid-overlay").waitFor();
  await page.getByRole("button", { name: "确认网格" }).click();
  await page.getByLabel("排班年份").fill("2026");
  await page.getByLabel("排班月份").fill("9");
  await page.getByRole("button", { name: "确认人员和日期" }).click();
}

test("从中文文本到下载 ICS", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("活动文本").fill("8月26日下午3点，在万达影城看电影，提前30分钟提醒");
  await page.getByRole("button", { name: "解析事件" }).click();
  await expect(page.getByLabel("事件标题")).toHaveValue("看电影");
  await expect(page.getByLabel("开始日期")).toHaveValue(/-08-26$/);
  await expect(page.getByLabel("开始时间")).toHaveValue("15:00");
  await expect(page.getByLabel("地点")).toHaveValue("万达影城");
  await page.getByLabel("事件标题").fill("周末电影");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
});

test("单张截图 OCR 校对、证据高亮和 ICS 下载", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await page.setContent(
    '<div style="width:480px;height:220px;padding:20px;background:white;color:black;font:32px Arial">8月26日<br>下午3点<br>在万达影城看电影<br>提前30分钟提醒</div>',
  );
  const screenshot = await page.locator("div").screenshot({ type: "png" });
  await page.goto("/");
  await page.getByRole("button", { name: "图片识别" }).click();
  await page.getByLabel("选择图片").setInputFiles({
    name: "event.png",
    mimeType: "image/png",
    buffer: screenshot,
  });
  await expect(page.getByTestId("image-preview")).toBeVisible();
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByLabel("OCR 文本块 1")).toHaveValue("8月26日");
  await expect(page.getByTestId("ocr-box")).toHaveCount(4);
  await page.getByLabel("OCR 文本块 1").fill("8月27日");
  await page.getByRole("button", { name: "解析事件" }).click();
  await expect(page.getByLabel("事件标题")).toHaveValue("看电影");
  await expect(page.getByLabel("开始日期")).toHaveValue(/-08-27$/);
  await expect(page.getByLabel("开始时间")).toHaveValue("15:00");
  await expect(page.getByLabel("地点")).toHaveValue("万达影城");
  await expect(page.getByLabel("提醒时间")).toHaveValue("30");
  await page.getByLabel("开始时间").click();
  await expect(page.locator('[data-testid="ocr-box"][data-selected="true"]')).toHaveCount(2);
  await page.getByLabel("事件标题").fill("周末电影");
  await page.getByRole("button", { name: "重新解析并保留手工修改" }).click();
  await expect(page.getByLabel("事件标题")).toHaveValue("周末电影");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const contents = await readFile(downloadPath!, "utf8");
  expect(contents).toContain("SUMMARY:周末电影");
  expect(contents).toContain("TRIGGER:-PT30M");
  expect(externalRequests).toEqual([]);
});

test("多事件候选确认后批量下载一个含两个 VEVENT 的 ICS", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("活动文本")
    .fill(
      [
        "- 8月26日上午9点，在公司会议室开项目评审会",
        "- 8月27日下午2点，在客户办公室开需求沟通会",
        "- 8月28日晚上7点，在餐厅吃团队晚餐",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "解析事件" }).click();
  await expect(page.getByRole("heading", { name: "发现 3 个事件候选" })).toBeVisible();
  await expect(page.getByLabel("候选 1 事件标题")).toHaveValue("项目评审会");
  await expect(page.getByLabel("候选 2 开始时间")).toHaveValue("14:00");
  await page.getByLabel("候选 2 事件标题").fill("客户需求确认");
  await page.getByRole("button", { name: "确认候选 1" }).click();
  await page.getByRole("button", { name: "确认候选 2" }).click();
  await page.getByRole("button", { name: "忽略候选 3" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载所选事件 ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/2-events-snap2cal\.ics$/);
  const downloadPath = await download.path();
  const contents = await readFile(downloadPath!, "utf8");
  expect(contents.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
  expect(contents.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(contents).toContain("SUMMARY:客户需求确认");
  expect(contents).not.toContain("SUMMARY:团队晚餐");
});

test("单图 Mock OCR 生成三候选、证据高亮并下载三个 VEVENT", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await page.setContent(
    '<div style="width:480px;height:220px;padding:20px;background:white;color:black;font:28px Arial">8月26日<br>09:00 项目评审<br>14:00 客户沟通<br>19:00 团队晚餐</div>',
  );
  const screenshot = await page.locator("div").screenshot({ type: "png" });
  await page.goto("/?mockOcr=multi");
  await page.getByRole("button", { name: "图片识别" }).click();
  await page.getByLabel("选择图片").setInputFiles({
    name: "multi-event.png",
    mimeType: "image/png",
    buffer: screenshot,
  });
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByLabel("OCR 文本块 4")).toHaveValue("19:00 团队晚餐");
  await page.getByRole("button", { name: "解析事件" }).click();
  await expect(page.getByRole("heading", { name: "发现 3 个事件候选" })).toBeVisible();
  await page.getByRole("button", { name: "查看候选 2 原图证据" }).click();
  await expect(page.locator('[data-testid="ocr-box"][data-selected="true"]')).toHaveCount(2);
  await page.getByLabel("候选 2 开始时间").click();
  await expect(page.getByLabel("候选 2 开始时间")).toHaveValue("14:00");
  await page.getByLabel("候选 2 事件标题").fill("人工客户沟通");
  await page.getByRole("button", { name: "重新解析并保留手工修改" }).click();
  await expect(page.getByLabel("候选 2 事件标题")).toHaveValue("人工客户沟通");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载所选事件 ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/3-events-snap2cal\.ics$/);
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  expect(contents).toContain("SUMMARY:人工客户沟通");
  expect(externalRequests).toEqual([]);
});

test("课程表图片生成 6 次课程，排除一次后导出 5 个 VEVENT", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await page.setContent(
    '<div style="width:640px;height:185px;background:white;color:black;box-sizing:border-box;border:2px solid #111;font:16px Arial">课程表测试图</div>',
  );
  const screenshot = await page.locator("div").screenshot({ type: "png" });
  await page.goto("/?mockOcr=schedule");
  await page.getByRole("button", { name: "课程表" }).click();
  await page
    .getByLabel("选择图片")
    .setInputFiles({ name: "schedule.png", mimeType: "image/png", buffer: screenshot });
  await page.getByRole("button", { name: "开始识别" }).click();
  await expect(page.getByLabel("OCR 文本块 12")).toHaveValue("双周");
  await page.getByRole("button", { name: "检测课程表" }).click();
  await expect(page.getByTestId("schedule-grid-overlay")).toBeVisible();
  await page.getByRole("button", { name: "确认网格" }).click();
  await expect(page.getByLabel("第 2 行开始时间")).toHaveValue("08:00");
  await page.getByRole("button", { name: "确认表头和时间" }).click();
  await page.getByLabel("第一教学周的星期一日期").fill("2026-09-07");
  await page.getByLabel("本学期总周数").fill("4");
  await page.getByRole("button", { name: "生成课程模板与具体事件" }).click();
  await expect(page.getByRole("heading", { name: "课程模板与具体事件" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^包含 / })).toHaveCount(6);
  await page.getByLabel("包含 2026-09-21 高等数学").uncheck();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载全部选中课程 ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("2026-09-07-5-classes-snap2cal.ics");
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
  expect(contents.match(/BEGIN:VEVENT/g)).toHaveLength(5);
  expect(contents).toContain("SUMMARY:高等数学");
  expect(contents).toContain("SUMMARY:大学英语");
  expect(contents).toContain("DTSTART;TZID=Asia/Shanghai:20260907T080000");
  expect(contents).not.toContain("RRULE");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(externalRequests).toEqual([]);
});

test("课程表网格校正并纵向合并跨两行课程", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await page.setContent(
    '<div style="width:640px;height:185px;box-sizing:border-box;background:white;border:2px solid black">课程表</div>',
  );
  const screenshot = await page.locator("div").screenshot({ type: "png" });
  await page.goto("/?mockOcr=schedule&scheduleOffset=1");
  await page.getByRole("button", { name: "课程表" }).click();
  await page
    .getByLabel("选择图片")
    .setInputFiles({ name: "schedule-merge.png", mimeType: "image/png", buffer: screenshot });
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByRole("button", { name: "检测课程表" }).click();
  const preview = page.getByTestId("image-preview");
  const bounds = await preview.boundingBox();
  const line = page.getByRole("button", { name: /水平网格线 130/ });
  const svgBounds = await line.evaluate((element) => {
    const bounds = (element as SVGLineElement).ownerSVGElement!.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  const lineHandle = await line.elementHandle();
  expect(bounds).not.toBeNull();
  expect(lineHandle).not.toBeNull();
  const clientX = svgBounds.x + svgBounds.width / 2;
  await lineHandle!.dispatchEvent("pointerdown", {
    pointerId: 7,
    buttons: 1,
    clientX,
    clientY: svgBounds.y + (130 / 185) * svgBounds.height,
  });
  await lineHandle!.dispatchEvent("pointermove", {
    pointerId: 7,
    buttons: 1,
    clientX,
    clientY: svgBounds.y + (120 / 185) * svgBounds.height,
  });
  await lineHandle!.dispatchEvent("pointerup", { pointerId: 7, buttons: 0 });
  await expect(page.getByText(/当前水平线：120 px/)).toBeVisible();
  await page.getByRole("button", { name: "确认网格" }).click();
  await page.getByLabel("选择课程单元格 2-2").check();
  await page.getByLabel("选择课程单元格 3-2").check();
  await page.getByRole("button", { name: "合并课程单元格" }).click();
  await page.getByLabel("单元格 3-4 角色").selectOption("ignored");
  await page.getByRole("button", { name: "确认表头和时间" }).click();
  await page.getByLabel("第一教学周的星期一日期").fill("2026-09-07");
  await page.getByLabel("本学期总周数").fill("1");
  await page.getByRole("button", { name: "生成课程模板与具体事件" }).click();
  await expect(page.getByLabel("课程 1 名称")).toHaveValue("高等数学");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载全部选中课程 ICS" }).click();
  const contents = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(contents.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(contents).toContain("DTSTART;TZID=Asia/Shanghai:20260907T080000");
  expect(contents).toContain("DTEND;TZID=Asia/Shanghai:20260907T114000");
  expect(contents).not.toContain("RRULE");
  expect(externalRequests).toEqual([]);
});

test("个人排班跨夜并排除一次后导出两个 VEVENT", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await openMockRoster(page);
  await configureRosterDefinitions(page);
  await page.getByRole("button", { name: "生成班次事件" }).click();
  await expect(page.getByRole("checkbox", { name: /^导出 / })).toHaveCount(6);
  await expect(page.getByText("20:00-次日 08:00").first()).toBeVisible();
  await page.getByLabel("导出 2026-09-04 张三 早班").uncheck();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载个人排班 ICS" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("张三-2026-09-排班-Snap2Cal.ics");
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(contents).toContain("DTSTART;TZID=Asia/Shanghai:20260902T200000");
  expect(contents).toContain("DTEND;TZID=Asia/Shanghai:20260903T080000");
  expect(contents).not.toContain("SUMMARY:休息");
  expect(contents).not.toContain("RRULE");
  expect(externalRequests).toEqual([]);
});

test("团队导出阻止未知代码并在映射全天培训后生成六个 VEVENT", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await openMockRoster(page);
  await configureRosterDefinitions(page);
  await page.getByRole("button", { name: "张三 2026-09-02 班次 N" }).click();
  await page.getByLabel("活动 assignment 班次代码").fill("X");
  await page.getByRole("button", { name: "生成班次事件" }).click();
  await expect(page.getByRole("button", { name: "下载团队排班 ICS" })).toBeDisabled();
  await expect(page.getByText(/非空 assignment 尚未完成有效映射/)).toBeVisible();

  await page.getByRole("button", { name: "新增班次定义" }).click();
  await page.getByLabel("班次 4 主代码").fill("X");
  await page.getByLabel("班次 4 名称").fill("培训");
  await page.getByLabel("班次 4 类型").selectOption("all-day");
  await page.getByRole("button", { name: "确认班次定义" }).nth(3).click();
  await expect(page.getByRole("button", { name: "下载团队排班 ICS" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载团队排班 ICS" }).click();
  const contents = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(contents.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
  expect(contents.match(/BEGIN:VEVENT/g)).toHaveLength(6);
  expect(contents).toContain("SUMMARY:张三 · 培训");
  expect(contents).toContain("DTSTART;VALUE=DATE:20260902");
  expect(contents).not.toContain("SUMMARY:张三 · 休息");
  expect(contents).not.toContain("RRULE");
  expect(externalRequests).toEqual([]);
});

test("真实投影网格可校正并保持 assignment 原图证据", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== E2E_ORIGIN)
      externalRequests.push(url.href);
  });
  await page.setContent(`
    <table style="width:600px;height:180px;box-sizing:border-box;border-collapse:collapse;background:white">
      ${Array.from({ length: 3 }, () => `<tr>${Array.from({ length: 5 }, () => '<td style="border:2px solid #111"></td>').join("")}</tr>`).join("")}
    </table>
  `);
  const screenshot = await page.locator("table").screenshot({ type: "png" });
  await page.goto("/?mockOcr=roster&realGrid=1");
  await page.getByRole("button", { name: "排班表" }).click();
  await page
    .getByLabel("选择图片")
    .setInputFiles({ name: "real-roster.png", mimeType: "image/png", buffer: screenshot });
  await page.getByRole("button", { name: "开始识别" }).click();
  await page.getByRole("button", { name: "检测排班表" }).click();
  await page.getByTestId("roster-grid-overlay").waitFor();
  await expect(page.getByText(/垂直线 6/)).toBeVisible();
  const verticalLine = page.getByRole("button", { name: /^垂直网格线 \d+$/ }).nth(1);
  const detectedPosition = Number(
    (await verticalLine.getAttribute("aria-label"))?.match(/\d+$/)?.[0],
  );
  expect(detectedPosition).toBeGreaterThan(0);
  await verticalLine.focus();
  await verticalLine.press("ArrowRight");
  await expect(page.getByText(`当前垂直线：${detectedPosition + 1} px`)).toBeVisible();
  await page.getByRole("button", { name: "确认网格" }).click();
  await page.getByLabel("排班年份").fill("2026");
  await page.getByLabel("排班月份").fill("9");
  await page.getByRole("button", { name: "确认人员和日期" }).click();
  await configureRosterDefinitions(page);
  await page.getByRole("button", { name: "张三 2026-09-01 班次 A" }).click();
  await expect(page.locator('[data-testid="ocr-box"][data-evidence="true"]')).toHaveCount(1);
  await page.getByLabel("活动 assignment 班次代码").fill("N");
  await expect(page.getByText("OCR 原文：A")).toBeVisible();
  await page.getByRole("button", { name: "生成班次事件" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载个人排班 ICS" }).click();
  const contents = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(contents).toContain("SUMMARY:夜班");
  expect(contents).not.toContain("RRULE");
  expect(externalRequests).toEqual([]);
});
