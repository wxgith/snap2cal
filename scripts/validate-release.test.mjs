import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  createValidDist,
  createValidRepository,
  readPackage,
  writeFixture,
  writePackage,
} from "./__tests__/test-fixtures.mjs";
import { packageRelease } from "./package-release.mjs";
import { validateReleaseArtifact } from "./validate-release.mjs";

const roots = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "snap2cal-release-validator-"));
  roots.push(root);
  await createValidRepository(root);
  await createValidDist(root);
  return root;
}

const validationOptions = {
  requiredFiles: [],
  trackedFiles: ["README.md"],
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release artifact packaging and validation", () => {
  it("creates a versioned ZIP and verifiable SHA-256 manifest", async () => {
    const root = await fixtureRoot();
    const packaged = await packageRelease({ root, tag: "v0.1.0", ...validationOptions });
    const result = await validateReleaseArtifact({ root, tag: "v0.1.0", ...validationOptions });
    expect(packaged.zipName).toBe("snap2cal-v0.1.0-static-site.zip");
    expect(packaged.checksumName).toBe("snap2cal-v0.1.0-SHA256SUMS.txt");
    expect(result.errors).toEqual([]);
    expect(result.metrics.sha256).toBe(packaged.sha256);
  });

  it("uses exactly one static-site root with legal and runtime files", async () => {
    const root = await fixtureRoot();
    const packaged = await packageRelease({ root, ...validationOptions });
    const entries = unzipSync(new Uint8Array(await readFile(packaged.zipPath)));
    const rootsInZip = new Set(Object.keys(entries).map((name) => name.split("/", 1)[0]));
    expect([...rootsInZip]).toEqual(["snap2cal-v0.1.0"]);
    expect(entries["snap2cal-v0.1.0/LICENSE"]).toBeDefined();
    expect(entries["snap2cal-v0.1.0/THIRD_PARTY_NOTICES.md"]).toBeDefined();
    expect(entries["snap2cal-v0.1.0/index.html"]).toBeDefined();
    expect(strFromU8(entries["snap2cal-v0.1.0/VERSION.txt"])).toContain("0.1.0");
  });

  it("rejects a tag that does not match package.json", async () => {
    const root = await fixtureRoot();
    await expect(packageRelease({ root, tag: "v9.9.9", ...validationOptions })).rejects.toThrow(
      "does not match package version",
    );
  });

  it("detects a tampered checksum manifest", async () => {
    const root = await fixtureRoot();
    const packaged = await packageRelease({ root, ...validationOptions });
    await writeFile(packaged.checksumPath, `${"0".repeat(64)}  ${packaged.zipName}\n`, "utf8");
    const result = await validateReleaseArtifact({ root, ...validationOptions });
    expect(result.errors.some((error) => error.includes("does not match the archive digest"))).toBe(
      true,
    );
  });

  it("rejects forbidden test content inside the ZIP", async () => {
    const root = await fixtureRoot();
    await writeFixture(root, "dist/tests/private.txt", "synthetic forbidden release file\n");
    await packageRelease({ root, ...validationOptions });
    const result = await validateReleaseArtifact({ root, ...validationOptions });
    expect(result.errors.some((error) => error.includes("forbidden path"))).toBe(true);
  });

  it("creates a non-publishable preview with blockers when LICENSE is absent", async () => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "LICENSE"));
    const current = await readPackage(root);
    await writePackage(root, { ...current, license: "UNLICENSED" });
    await writeFixture(
      root,
      "RELEASE_BLOCKERS.md",
      "# Blockers\n\n- [ ] Confirm open-source license\n- [ ] Confirm copyright holder name or organization\n",
    );
    const packaged = await packageRelease({ root, ...validationOptions });
    const entries = unzipSync(new Uint8Array(await readFile(packaged.zipPath)));
    const result = await validateReleaseArtifact({ root, ...validationOptions });
    expect(packaged.publishable).toBe(false);
    expect(entries["snap2cal-v0.1.0/RELEASE_BLOCKERS.md"]).toBeDefined();
    expect(entries["snap2cal-v0.1.0/LICENSE"]).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.blockers).toContain("Confirm open-source license");
  });

  it("fails publishable packaging while LICENSE is absent", async () => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "LICENSE"));
    const current = await readPackage(root);
    await writePackage(root, { ...current, license: "UNLICENSED" });
    await writeFixture(
      root,
      "RELEASE_BLOCKERS.md",
      "# Blockers\n\n- [ ] Confirm open-source license\n- [ ] Confirm copyright holder name or organization\n",
    );
    await expect(
      packageRelease({ root, requirePublishable: true, ...validationOptions }),
    ).rejects.toThrow(/Publishable validation blocked|requires LICENSE/);
  });

  it("refuses to package a production Mock", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "dist", "assets", "index-main.js"), "MockGridDetector", "utf8");
    await expect(packageRelease({ root, ...validationOptions })).rejects.toThrow(
      /MockGridDetector/,
    );
  });
});
