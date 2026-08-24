import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import Tesseract from "tesseract.js";

const root = process.cwd();
const directory = path.join(root, "public", "ocr");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
let total = 0;
for (const expected of manifest.files) {
  const data = await readFile(path.join(directory, expected.path));
  const digest = createHash("sha256").update(data).digest("hex");
  if (data.length !== expected.bytes || digest !== expected.sha256)
    throw new Error(`OCR resource verification failed: ${expected.path}`);
  total += data.length;
}
console.log(`Verified ${manifest.files.length} local OCR resources (${total} bytes).`);

const browser = await chromium.launch();
let screenshot;
try {
  const page = await browser.newPage({
    viewport: { width: 900, height: 320 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<div style="width:860px;height:280px;padding:20px;background:white;color:black;font:48px Arial, sans-serif;line-height:1.5">8月26日 下午3点<br>在万达影城看电影<br>提前30分钟提醒</div>',
  );
  screenshot = await page.locator("div").screenshot({ type: "png" });
} finally {
  await browser.close();
}

const worker = await Tesseract.createWorker(["chi_sim", "eng"], Tesseract.OEM.LSTM_ONLY, {
  langPath: langOutputPath(directory),
  gzip: true,
  cacheMethod: "none",
  logger: (message) => {
    if (message.status === "recognizing text")
      process.stdout.write(`OCR ${Math.round(message.progress * 100)}%\r`);
  },
});
try {
  const result = await worker.recognize(screenshot);
  const text = result.data.text.trim();
  if (!text) throw new Error("Real OCR smoke test returned no text.");
  console.log(
    `\nReal Tesseract OCR returned ${text.length} characters: ${JSON.stringify(text.slice(0, 80))}`,
  );
} finally {
  await worker.terminate();
}
console.log("OCR resource integrity and real-engine smoke verification passed without cloud OCR.");

const port = 4198;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, stdio: "ignore" },
);
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) break;
    } catch {
      if (attempt === 49) throw new Error("Could not start browser OCR smoke server.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const smokeBrowser = await chromium.launch();
  try {
    const page = await smokeBrowser.newPage();
    const externalRequests = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin)
        externalRequests.push(url.href);
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "图片识别" }).click();
    await page
      .getByLabel("选择图片")
      .setInputFiles({ name: "real-ocr-smoke.png", mimeType: "image/png", buffer: screenshot });
    await page.getByRole("button", { name: "开始识别" }).click();
    await page.getByLabel("OCR 文本块 1").waitFor({ timeout: 120_000 });
    const browserText = await page
      .locator('[aria-label^="OCR 文本块"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value));
    if (!browserText.join("").trim()) throw new Error("Browser OCR smoke test returned no text.");
    if (externalRequests.length)
      throw new Error(`Browser OCR made third-party requests: ${externalRequests.join(", ")}`);
    console.log(
      `Browser worker OCR returned ${browserText.length} text blocks using only ${origin}.`,
    );
  } finally {
    await smokeBrowser.close();
  }
} finally {
  server.kill();
}

function langOutputPath(base) {
  return path.join(base, "lang");
}
