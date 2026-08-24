import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  isMainModule,
  listFiles,
  pathExists,
  relativePath,
  reportValidation,
  REPOSITORY_ROOT,
} from "./lib/fs-utils.mjs";

const IDENTIFIERS = [
  "MockOcrAdapter",
  "MockGridDetector",
  "MockRoster",
  "MOCK_MULTI_EVENT_RESULT",
  "MOCK_SCHEDULE_RESULT",
  "MOCK_ROSTER_RESULT",
  "VITE_SNAP2CAL_MOCK_OCR",
  "mockOcr",
  "mockGrid",
  "testQuery",
  "PLAYWRIGHT",
  "E2E_ONLY",
];

export async function validateProductionMocks(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const distPath = path.resolve(options.distPath ?? path.join(root, "dist"));
  const errors = [];
  const warnings = [];
  const blockers = [];
  if (!(await pathExists(distPath)))
    return { errors: ["dist directory is missing."], warnings, blockers, scannedFiles: 0 };

  const files = (await listFiles(distPath)).filter((file) =>
    [".css", ".html", ".js", ".json"].includes(path.extname(file).toLowerCase()),
  );
  for (const file of files) {
    const relative = relativePath(distPath, file);
    if (/(?:^|\/)(?:mock|test|e2e)[^/]*\.(?:js|json)$/i.test(relative))
      errors.push(`${relative} has a production-forbidden test filename.`);
    const text = await readFile(file, "utf8");
    for (const identifier of IDENTIFIERS) {
      if (text.includes(identifier)) errors.push(`${relative} contains ${identifier}.`);
    }
    if (/URLSearchParams\([^)]*\).*?(?:mock|test|e2e)/is.test(text))
      errors.push(`${relative} contains a test-controlled URL query path.`);
  }

  errors.sort((a, b) => a.localeCompare(b, "en"));
  return { errors: [...new Set(errors)], warnings, blockers, scannedFiles: files.length };
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await validateProductionMocks();
    if (
      !reportValidation("Production Mock validation", result, {
        summary: `Scanned ${result.scannedFiles} production text asset(s).`,
      })
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
