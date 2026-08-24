import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateRepository } from "./validate-repo.mjs";
import {
  createValidRepository,
  readPackage,
  writeFixture,
  writePackage,
} from "./__tests__/test-fixtures.mjs";

const roots = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "snap2cal-repo-validator-"));
  roots.push(root);
  await createValidRepository(root);
  return root;
}

async function validate(root, options = {}) {
  return validateRepository({ root, requiredFiles: [], trackedFiles: ["README.md"], ...options });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository validator", () => {
  it("accepts a complete synthetic repository fixture", async () => {
    const result = await validate(await fixtureRoot());
    expect(result.errors).toEqual([]);
    expect(result.blockers).toEqual([]);
  });

  it("reports a missing README", async () => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "README.md"));
    const result = await validateRepository({
      root,
      requiredFiles: ["README.md"],
      trackedFiles: ["README.zh-CN.md"],
    });
    expect(result.errors).toContain("Missing required file: README.md");
  });

  it("rejects a missing LICENSE that has no explicit blocker", async () => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "LICENSE"));
    await writePackage(root, { license: "UNLICENSED" });
    const result = await validate(root);
    expect(result.errors).toContain("LICENSE is missing without an open-source-license blocker.");
  });

  it("records an unconfirmed LICENSE as a blocker instead of inventing one", async () => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "LICENSE"));
    await writePackage(root, { license: "UNLICENSED" });
    await writeFixture(
      root,
      "RELEASE_BLOCKERS.md",
      "# Blockers\n\n- [ ] Confirm open-source license\n- [x] Confirm copyright holder name or organization\n",
    );
    const result = await validate(root);
    expect(result.errors).toEqual([]);
    expect(result.blockers).toContain("Confirm open-source license");
  });

  it("rejects a personal absolute path", async () => {
    const root = await fixtureRoot();
    const personalPath = "C:" + "\\Users\\example-user\\private.png";
    await writeFixture(root, "notes.md", `Do not publish ${personalPath}\n`);
    const result = await validate(root);
    expect(result.errors.some((error) => error.includes("Windows user profile"))).toBe(true);
  });

  it("redacts a suspected secret from validation output", async () => {
    const root = await fixtureRoot();
    const secret = ["gh", "p_"].join("") + "A".repeat(30);
    await writeFixture(root, "notes.md", `token=${secret}\n`);
    const result = await validate(root);
    expect(result.errors.some((error) => error.includes("suspected GitHub classic token"))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("rejects an explicit private-demo marker", async () => {
    const root = await fixtureRoot();
    const marker = "SNAP2CAL" + "_PRIVATE_FIXTURE";
    await writeFixture(root, "fixtures/public-demo/private.txt", marker);
    const result = await validate(root);
    expect(result.errors.some((error) => error.includes("unredacted-demo marker"))).toBe(true);
  });

  it("rejects a package version missing from the changelog", async () => {
    const root = await fixtureRoot();
    const current = await readPackage(root);
    await writePackage(root, { ...current, version: "0.2.0" });
    const result = await validate(root);
    expect(result.errors).toContain("CHANGELOG.md has no section for package version 0.2.0.");
  });

  it("rejects a package license inconsistent with LICENSE", async () => {
    const root = await fixtureRoot();
    const current = await readPackage(root);
    await writePackage(root, { ...current, license: "Apache-2.0" });
    const result = await validate(root);
    expect(result.errors.some((error) => error.includes("does not match MIT"))).toBe(true);
  });

  it("rejects a broken documentation link", async () => {
    const root = await fixtureRoot();
    await writeFixture(root, "notes.md", "[Missing](docs/not-here.md)\n");
    const result = await validate(root);
    expect(result.errors).toContain("notes.md links to missing path docs/not-here.md.");
  });

  it("rejects invalid workflow YAML", async () => {
    const root = await fixtureRoot();
    await writeFixture(root, ".github/workflows/bad.yml", "name: bad\njobs: [\n");
    const result = await validate(root);
    expect(result.errors).toContain(".github/workflows/bad.yml is not valid YAML.");
  });

  it("rejects tracked dist and node_modules paths", async () => {
    const root = await fixtureRoot();
    const result = await validateRepository({
      root,
      requiredFiles: [],
      trackedFiles: ["README.md", "dist/index.html", "node_modules/example/index.js"],
    });
    expect(result.errors).toContain("Generated production path is tracked: dist/index.html");
    expect(result.errors).toContain(
      "Generated dependency path is tracked: node_modules/example/index.js",
    );
  });

  it("turns an unresolved blocker into a publishable-validation error", async () => {
    const root = await fixtureRoot();
    await writeFixture(
      root,
      "RELEASE_BLOCKERS.md",
      "# Blockers\n\n- [x] Confirm open-source license\n- [ ] Confirm copyright holder name or organization\n",
    );
    const result = await validate(root, { requirePublishable: true });
    expect(result.errors).toContain(
      "Publishable validation blocked: Confirm copyright holder name or organization",
    );
  });
});
