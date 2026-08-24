import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import {
  formatBytes,
  isMainModule,
  parseCliArguments,
  pathExists,
  reportValidation,
  REPOSITORY_ROOT,
  sha256,
} from "./lib/fs-utils.mjs";
import { validateDist } from "./validate-dist.mjs";
import { validateProductionMocks } from "./validate-production-mocks.mjs";
import { validateRepository } from "./validate-repo.mjs";

const FORBIDDEN_PATH_PARTS = [
  ".env",
  ".git",
  "coverage",
  "e2e",
  "node_modules",
  "playwright-report",
  "src",
  "test-results",
  "tests",
  "trace",
];

const MOCK_MARKERS = [
  "MockOcrAdapter",
  "MockGridDetector",
  "MockRoster",
  "mockOcr",
  "VITE_SNAP2CAL_MOCK_OCR",
  "PLAYWRIGHT",
  "E2E_ONLY",
];

function addIssue(collection, message) {
  if (!collection.includes(message)) collection.push(message);
}

function isTextEntry(name) {
  return [".css", ".html", ".js", ".json", ".md", ".svg", ".txt"].includes(
    path.posix.extname(name).toLowerCase(),
  );
}

export async function validateReleaseArtifact(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const releasePath = path.resolve(options.releasePath ?? path.join(root, "release"));
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = packageJson.version;
  const zipName = `snap2cal-v${version}-static-site.zip`;
  const checksumName = `snap2cal-v${version}-SHA256SUMS.txt`;
  const zipPath = path.join(releasePath, zipName);
  const checksumPath = path.join(releasePath, checksumName);
  const errors = [];
  const warnings = [];
  const blockers = [];

  const repository = await validateRepository({
    root,
    requirePublishable: options.requirePublishable === true,
    requiredFiles: options.requiredFiles,
    trackedFiles: options.trackedFiles,
  });
  errors.push(...repository.errors);
  warnings.push(...repository.warnings);
  blockers.push(...repository.blockers);
  const dist = await validateDist({ root, distPath: options.distPath ?? path.join(root, "dist") });
  errors.push(...dist.errors);
  const mocks = await validateProductionMocks({
    root,
    distPath: options.distPath ?? path.join(root, "dist"),
  });
  errors.push(...mocks.errors);

  if (options.tag && options.tag !== `v${version}`)
    addIssue(errors, `Tag ${options.tag} does not match package version v${version}.`);
  if (!(await pathExists(zipPath))) addIssue(errors, `Release archive is missing: ${zipName}.`);
  if (!(await pathExists(checksumPath)))
    addIssue(errors, `Checksum file is missing: ${checksumName}.`);
  if (errors.length || !(await pathExists(zipPath)) || !(await pathExists(checksumPath)))
    return { errors: [...new Set(errors)].sort(), warnings, blockers, metrics: null };

  const archive = await readFile(zipPath);
  const digest = sha256(archive);
  const checksumText = await readFile(checksumPath, "utf8");
  const checksumMatch = checksumText.match(/^([a-f0-9]{64}) {2}([^\r\n]+)\r?\n?$/i);
  if (!checksumMatch) addIssue(errors, `${checksumName} has an invalid SHA-256 manifest format.`);
  else {
    if (checksumMatch[1].toLowerCase() !== digest)
      addIssue(errors, `${checksumName} does not match the archive digest.`);
    if (checksumMatch[2] !== zipName)
      addIssue(errors, `${checksumName} references ${checksumMatch[2]} instead of ${zipName}.`);
  }

  let entries = {};
  try {
    entries = unzipSync(new Uint8Array(archive));
  } catch {
    addIssue(errors, `${zipName} is not a readable ZIP archive.`);
  }
  const names = Object.keys(entries);
  const roots = new Set(names.map((name) => name.split("/", 1)[0]).filter(Boolean));
  const expectedRoot = `snap2cal-v${version}`;
  if (roots.size !== 1 || !roots.has(expectedRoot))
    addIssue(errors, `Release ZIP must have one root directory named ${expectedRoot}.`);

  for (const name of names) {
    if (name.startsWith("/") || name.includes("../") || /^[A-Za-z]:/.test(name))
      addIssue(errors, `Release ZIP contains an unsafe path: ${name}.`);
    const parts = name.toLowerCase().split("/");
    if (parts.some((part) => FORBIDDEN_PATH_PARTS.includes(part)))
      addIssue(errors, `Release ZIP contains forbidden path: ${name}.`);
    if (isTextEntry(name)) {
      const text = strFromU8(entries[name]);
      for (const marker of MOCK_MARKERS) {
        if (text.includes(marker))
          addIssue(errors, `Release ZIP entry ${name} contains ${marker}.`);
      }
      if (
        /[A-Za-z]:(?:[\\/]|\\\\)Users(?:[\\/]|\\\\)[^\\/\s]+(?:[\\/]|\\\\)|Documents[\\/]ChatGPT|\/home\/[^/\s]+\//i.test(
          text,
        )
      )
        addIssue(errors, `Release ZIP entry ${name} contains a developer path.`);
      if (/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}/.test(text))
        addIssue(errors, `Release ZIP entry ${name} contains a suspected secret; value redacted.`);
    }
  }

  const required = [
    `${expectedRoot}/index.html`,
    `${expectedRoot}/README.txt`,
    `${expectedRoot}/THIRD_PARTY_NOTICES.md`,
    `${expectedRoot}/VERSION.txt`,
    `${expectedRoot}/ocr/worker.min.js`,
    `${expectedRoot}/ocr/lang/chi_sim.traineddata.gz`,
    `${expectedRoot}/ocr/lang/eng.traineddata.gz`,
  ];
  for (const name of required) {
    if (!(name in entries)) addIssue(errors, `Release ZIP is missing ${name}.`);
  }
  if (!names.some((name) => name.startsWith(`${expectedRoot}/ocr/core/`) && name.endsWith(".wasm")))
    addIssue(errors, "Release ZIP is missing an OCR WASM core.");

  const hasSourceLicense = await pathExists(path.join(root, "LICENSE"));
  if (hasSourceLicense) {
    if (!(`${expectedRoot}/LICENSE` in entries))
      addIssue(errors, "Release ZIP is missing LICENSE.");
    if (!repository.blockers.length && `${expectedRoot}/RELEASE_BLOCKERS.md` in entries)
      addIssue(errors, "Publishable release ZIP unexpectedly contains RELEASE_BLOCKERS.md.");
  } else {
    if (!blockers.some((blocker) => /open-source license/i.test(blocker)))
      addIssue(blockers, "Release ZIP has no LICENSE because the source license is unconfirmed.");
    else
      addIssue(
        warnings,
        "Release ZIP omits LICENSE and includes RELEASE_BLOCKERS.md as expected for a preview.",
      );
    if (!(`${expectedRoot}/RELEASE_BLOCKERS.md` in entries))
      addIssue(
        errors,
        "Preview release ZIP must include RELEASE_BLOCKERS.md when LICENSE is absent.",
      );
  }
  if (options.requirePublishable && !hasSourceLicense)
    addIssue(errors, "Publishable release validation requires LICENSE.");

  const uncompressedBytes = Object.values(entries).reduce((sum, data) => sum + data.length, 0);
  if (uncompressedBytes > 60_000_000)
    addIssue(errors, `Release ZIP expands to ${uncompressedBytes} bytes, above the 60 MB budget.`);
  const metrics = {
    zipBytes: (await stat(zipPath)).size,
    uncompressedBytes,
    entryCount: names.length,
    sha256: digest,
    zipName,
    checksumName,
  };
  return {
    errors: [...new Set(errors)].sort((left, right) => left.localeCompare(right, "en")),
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right, "en")),
    blockers: [...new Set(blockers)].sort((left, right) => left.localeCompare(right, "en")),
    metrics,
  };
}

if (isMainModule(import.meta.url)) {
  const argumentsMap = parseCliArguments(process.argv.slice(2));
  try {
    const result = await validateReleaseArtifact({
      requirePublishable: argumentsMap.has("--require-publishable"),
      tag: argumentsMap.get("--tag"),
    });
    const metrics = result.metrics;
    if (
      !reportValidation("Release artifact validation", result, {
        summary: metrics
          ? `${metrics.zipName}: ${formatBytes(metrics.zipBytes)}, ${metrics.entryCount} entries, SHA-256 ${metrics.sha256}.`
          : undefined,
      })
    )
      process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
