import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLicenseReport, generateLicenseReport } from "./generate-license-report.mjs";

const packageJson = {
  name: "license-report-fixture",
  version: "1.0.0",
  dependencies: { example: "1.0.0" },
};

const packageLock = {
  name: "license-report-fixture",
  version: "1.0.0",
  lockfileVersion: 3,
  packages: {
    "": {
      name: "license-report-fixture",
      version: "1.0.0",
      dependencies: { example: "1.0.0" },
    },
    "node_modules/example": {
      version: "1.0.0",
      license: "MIT",
    },
  },
};

async function createFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "snap2cal-license-report-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

describe("dependency license report line endings", () => {
  it("generates identical content from LF and CRLF lockfiles", async () => {
    const root = await createFixtureRoot();
    const lockText = `${JSON.stringify(packageLock, null, 2)}\n`;
    try {
      await writeFile(path.join(root, "package-lock.json"), lockText);
      const lfReport = await buildLicenseReport(root);

      await writeFile(path.join(root, "package-lock.json"), lockText.replaceAll("\n", "\r\n"));
      const crlfReport = await buildLicenseReport(root);

      expect(crlfReport.content).toBe(lfReport.content);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a generated report checked out with CRLF", async () => {
    const root = await createFixtureRoot();
    const lockText = `${JSON.stringify(packageLock, null, 2)}\n`;
    try {
      await writeFile(path.join(root, "package-lock.json"), lockText);
      await generateLicenseReport({ root });

      const reportPath = path.join(root, "docs", "dependency-licenses.md");
      const reportText = await readFile(reportPath, "utf8");
      await writeFile(reportPath, reportText.replaceAll("\n", "\r\n"));

      await expect(generateLicenseReport({ root, check: true })).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
