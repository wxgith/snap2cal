import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isMainModule,
  parseCliArguments,
  pathExists,
  relativePath,
  REPOSITORY_ROOT,
  sha256,
} from "./lib/fs-utils.mjs";

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const markerIndex = lockPath.lastIndexOf(marker);
  const suffix = lockPath.slice(markerIndex + marker.length);
  const segments = suffix.split("/");
  return suffix.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value.type === "string" && value.type.trim()) return value.type.trim();
  return "UNKNOWN";
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export async function buildLicenseReport(root = REPOSITORY_ROOT) {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const lockText = normalizeLineEndings(
    await readFile(path.join(root, "package-lock.json"), "utf8"),
  );
  const lock = JSON.parse(lockText);
  const runtimeDirect = new Set(Object.keys(packageJson.dependencies ?? {}));
  const developmentDirect = new Set(Object.keys(packageJson.devDependencies ?? {}));
  const rows = [];

  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!lockPath || !lockPath.includes("node_modules/")) continue;
    const name = metadata.name ?? packageNameFromLockPath(lockPath);
    const direct = runtimeDirect.has(name) || developmentDirect.has(name);
    const production = metadata.dev !== true;
    rows.push({
      name,
      version: metadata.version ?? "UNKNOWN",
      license: normalizeLicense(metadata.license),
      direct,
      production,
      lockPath,
    });
  }

  rows.sort(
    (left, right) =>
      left.name.localeCompare(right.name, "en") ||
      String(left.version).localeCompare(String(right.version), "en") ||
      left.lockPath.localeCompare(right.lockPath, "en"),
  );
  const unknown = rows.filter((row) => row.license === "UNKNOWN");
  const duplicateInstances =
    rows.length - new Set(rows.map((row) => `${row.name}@${row.version}`)).size;

  const lines = [
    "# Installed dependency licenses",
    "",
    "This report is generated from `package-lock.json` metadata by `npm run generate:license-report`. It is an inventory, not legal advice and not a replacement for upstream license texts.",
    "",
    `- Lockfile SHA-256: \`${sha256(lockText)}\``,
    `- Installed package entries: ${rows.length}`,
    `- Direct dependencies: ${rows.filter((row) => row.direct).length}`,
    `- Production dependency entries: ${rows.filter((row) => row.production).length}`,
    `- Duplicate nested package instances: ${duplicateInstances}`,
    `- Unknown license entries: ${unknown.length}`,
    "",
    "`Production` follows npm lockfile dependency classification. Build and test tools are not shipped as browser runtime modules, although their licenses still apply to repository tooling.",
    "",
    "| Package | Version | License | Direct | Production | Lockfile path |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${escapeTable(row.name)}\` | \`${escapeTable(row.version)}\` | ${escapeTable(row.license)} | ${row.direct ? "yes" : "no"} | ${row.production ? "yes" : "no"} | \`${escapeTable(row.lockPath)}\` |`,
    ),
    "",
  ];

  return { content: lines.join("\n"), rows, unknown };
}

export async function generateLicenseReport({ root = REPOSITORY_ROOT, check = false } = {}) {
  const outputPath = path.join(root, "docs", "dependency-licenses.md");
  const report = await buildLicenseReport(root);
  if (check) {
    if (!(await pathExists(outputPath)))
      throw new Error(
        `${relativePath(root, outputPath)} is missing; run npm run generate:license-report.`,
      );
    const current = normalizeLineEndings(await readFile(outputPath, "utf8"));
    if (current !== report.content)
      throw new Error(
        `${relativePath(root, outputPath)} is stale; regenerate it from package-lock.json.`,
      );
  } else {
    await writeFile(outputPath, report.content, "utf8");
  }
  if (report.unknown.length)
    throw new Error(
      `Dependency license metadata contains ${report.unknown.length} UNKNOWN entr${report.unknown.length === 1 ? "y" : "ies"}.`,
    );
  console.log(
    `${check ? "Verified" : "Generated"} dependency license report with ${report.rows.length} package entries and no UNKNOWN licenses.`,
  );
  return report;
}

if (isMainModule(import.meta.url)) {
  const argumentsMap = parseCliArguments(process.argv.slice(2));
  try {
    await generateLicenseReport({ check: argumentsMap.has("--check") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
