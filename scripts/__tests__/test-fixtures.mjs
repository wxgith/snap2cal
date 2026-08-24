import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const REQUIRED_SCRIPT_NAMES = [
  "capture:demo",
  "generate:license-report",
  "package:release",
  "test:a11y",
  "test:cross-browser",
  "validate:dist",
  "validate:production-mocks",
  "validate:release",
  "validate:repo",
  "validate:runtime-network",
  "verify:pages-base",
];

export async function writeFixture(root, relative, value) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
  return target;
}

export async function readPackage(root) {
  return JSON.parse(
    await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(root, "package.json"), "utf8"),
    ),
  );
}

export async function writePackage(root, overrides = {}) {
  const packageJson = {
    name: "snap2cal-validator-fixture",
    private: true,
    version: "0.1.0",
    description: "Synthetic validator fixture",
    license: "MIT",
    type: "module",
    engines: { node: ">=24 <25" },
    packageManager: "npm@11.12.1",
    scripts: Object.fromEntries(REQUIRED_SCRIPT_NAMES.map((name) => [name, "node noop.mjs"])),
    ...overrides,
  };
  await writeFixture(root, "package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
  return packageJson;
}

export async function createValidRepository(root) {
  await writePackage(root);
  await writeFixture(
    root,
    "package-lock.json",
    '{"name":"fixture","lockfileVersion":3,"packages":{}}\n',
  );
  await writeFixture(
    root,
    "README.md",
    "# Fixture\n\n[Chinese](README.zh-CN.md)\n\nLicense fixture; UNLICENSED is used only when LICENSE is removed.\n",
  );
  await writeFixture(
    root,
    "README.zh-CN.md",
    "# Fixture\n\n[English](README.md)\n\n测试许可证；移除 LICENSE 时使用 UNLICENSED。\n",
  );
  await writeFixture(root, "CHANGELOG.md", "# Changelog\n\n## 0.1.0\n\nSynthetic fixture.\n");
  await writeFixture(
    root,
    "LICENSE",
    "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n",
  );
  await writeFixture(
    root,
    "RELEASE_BLOCKERS.md",
    "# Blockers\n\n- [x] Confirm open-source license\n- [x] Confirm copyright holder name or organization\n",
  );
  await writeFixture(root, ".node-version", "24\n");
  await writeFixture(root, ".gitignore", "node_modules/\ndist/\npublic/ocr/\n.env*\n");
  await writeFixture(root, "fixtures/public-demo/demo-data.json", '{"synthetic":true}\n');
  await writeFixture(root, "public/demo/manifest.json", '{"synthetic":true}\n');
  await writeFixture(root, "THIRD_PARTY_NOTICES.md", "# Notices\n\nSynthetic fixture.\n");
  await writeFixture(root, "docs/release-archive.md", "# Static archive\n\nServe over HTTP.\n");
}

export async function createValidDist(root, budgetOverrides = {}) {
  const files = {
    "dist/index.html":
      '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-style.css"><link rel="icon" href="/favicon.svg"></head><body><script type="module" src="/assets/index-main.js"></script></body></html>',
    "dist/assets/index-style.css": "body{color:#111}",
    "dist/assets/index-main.js": "console.info('application')",
    "dist/assets/ScheduleTableWorkspace-one.js": "export const schedule=true",
    "dist/assets/ShiftRosterWorkspace-one.js": "export const roster=true",
    "dist/assets/TesseractOcrAdapter-one.js": "export const ocr=true",
    "dist/assets/ProjectionGridDetector-one.js": "export const grid=true",
    "dist/ocr/worker.min.js": "self.onmessage=()=>{}",
    "dist/ocr/core/tesseract-core.wasm": new Uint8Array([0, 97, 115, 109]),
    "dist/ocr/lang/chi_sim.traineddata.gz": new Uint8Array([1, 2, 3]),
    "dist/ocr/lang/eng.traineddata.gz": new Uint8Array([1, 2, 3]),
    "dist/demo/single-event.png": new Uint8Array([1]),
    "dist/demo/multi-event.png": new Uint8Array([1]),
    "dist/demo/timetable.png": new Uint8Array([1]),
    "dist/demo/shift-roster.png": new Uint8Array([1]),
    "dist/favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  };
  for (const [relative, value] of Object.entries(files)) await writeFixture(root, relative, value);
  const budgets = {
    main: { rawBytes: 100000, gzipBytes: 100000 },
    scheduleTable: { rawBytes: 100000, gzipBytes: 100000 },
    shiftRoster: { rawBytes: 100000, gzipBytes: 100000 },
    ocrAdapter: { rawBytes: 100000, gzipBytes: 100000 },
    applicationJavaScriptRawBytes: 500000,
    distBytes: 1000000,
    ocrBytes: 500000,
    largestOcrFileBytes: 500000,
    ...budgetOverrides,
  };
  await writeFixture(root, "config/bundle-budgets.json", `${JSON.stringify(budgets, null, 2)}\n`);
  return { files, budgets };
}
