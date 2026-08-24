import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createOcrAssetManifest, removeRemoteOcrFallbacks } from "./lib/ocr-assets.mjs";

const root = process.cwd();
const output = path.join(root, "public", "ocr");
const coreOutput = path.join(output, "core");
const langOutput = path.join(output, "lang");
const languageBase = "https://tessdata.projectnaptha.com/4.0.0_fast";
const languages = ["chi_sim", "eng"];

async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function download(url, destination) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100_000) throw new Error("文件异常偏小");
      await writeFile(destination, bytes);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

await mkdir(coreOutput, { recursive: true });
await mkdir(langOutput, { recursive: true });
const upstreamWorker = await readFile(
  path.join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
  "utf8",
);
await writeFile(
  path.join(output, "worker.min.js"),
  removeRemoteOcrFallbacks(upstreamWorker),
  "utf8",
);

const coreFiles = [
  "tesseract-core.js",
  "tesseract-core.wasm",
  "tesseract-core.wasm.js",
  "tesseract-core-lstm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd.js",
  "tesseract-core-simd.wasm",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.js",
  "tesseract-core-relaxedsimd.wasm",
  "tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core-relaxedsimd-lstm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
];
for (const file of coreFiles) {
  await cp(path.join(root, "node_modules", "tesseract.js-core", file), path.join(coreOutput, file));
}

for (const language of languages) {
  const destination = path.join(langOutput, `${language}.traineddata.gz`);
  await download(`${languageBase}/${language}.traineddata.gz`, destination);
}

const relativeFiles = [
  "worker.min.js",
  ...coreFiles.map((file) => `core/${file}`),
  ...languages.map((language) => `lang/${language}.traineddata.gz`),
];
const files = [];
for (const relativeFile of relativeFiles) {
  const absoluteFile = path.join(output, relativeFile);
  const bytes = (await readFile(absoluteFile)).length;
  files.push({
    path: relativeFile.replaceAll("\\", "/"),
    bytes,
    sha256: await sha256(absoluteFile),
  });
}
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(createOcrAssetManifest(files), null, 2)}\n`,
);
console.log(`OCR resources prepared in ${output}`);
for (const file of files)
  console.log(`${file.path}: ${file.bytes} bytes (${file.sha256.slice(0, 12)}…)`);
