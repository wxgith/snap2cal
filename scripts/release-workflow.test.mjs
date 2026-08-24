import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "./lib/fs-utils.mjs";
import { releaseTagMetadata } from "./release-tag.mjs";

const workflowPath = path.join(REPOSITORY_ROOT, ".github", "workflows", "release.yml");

describe("release tag metadata", () => {
  it("matches the v1.0.0-rc.1 tag to the RC package version", () => {
    expect(releaseTagMetadata("v1.0.0-rc.1", "1.0.0-rc.1").channel).toBe("prerelease");
  });

  it("rejects a stable tag for a prerelease package", () => {
    expect(() => releaseTagMetadata("v1.0.0", "1.0.0-rc.1")).toThrow(
      "must equal package version v1.0.0-rc.1",
    );
  });

  it("does not classify a stable SemVer tag as a prerelease", () => {
    expect(releaseTagMetadata("v1.0.0", "1.0.0").channel).toBe("stable");
  });
});

describe("draft release workflow", () => {
  it("is parseable and keeps write permission scoped to the release job", async () => {
    const text = await readFile(workflowPath, "utf8");
    const document = parseDocument(text);
    expect(document.errors).toEqual([]);
    const workflow = document.toJS();

    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs["draft-release"].permissions).toEqual({ contents: "write" });
    expect(Object.keys(workflow.jobs)).toEqual(["draft-release"]);
  });

  it("creates one verified draft that is never Latest and conditionally marks RC tags", async () => {
    const text = await readFile(workflowPath, "utf8");
    const document = parseDocument(text);
    const workflow = document.toJS();
    const createStep = workflow.jobs["draft-release"].steps.find(
      (step) => step.name === "Create Draft Release",
    );

    expect(text.match(/\bgh release create\b/g) ?? []).toHaveLength(1);
    expect(createStep.run).toContain("--draft");
    expect(createStep.run).toContain("--verify-tag");
    expect(createStep.run).toContain("--latest=false");
    expect(createStep.run).toContain("release_flags+=(--prerelease)");
    expect(createStep.run).toContain('scripts/release-tag.mjs "$RELEASE_TAG"');
    expect(createStep.run).toContain('"release/snap2cal-${RELEASE_TAG}-static-site.zip"');
    expect(createStep.run).toContain('"release/snap2cal-${RELEASE_TAG}-SHA256SUMS.txt"');
  });

  it("contains no publishing, force-push, or draft-promotion command", async () => {
    const text = await readFile(workflowPath, "utf8");
    expect(text).not.toMatch(/\bnpm\s+publish\b/i);
    expect(text).not.toMatch(/\bgit\s+push\b[^\n]*(?:--force|-f\b)/i);
    expect(text).not.toMatch(/\bgh\s+release\s+publish\b/i);
    expect(text).not.toMatch(/--draft(?:=|\s+)false\b/i);
  });
});
