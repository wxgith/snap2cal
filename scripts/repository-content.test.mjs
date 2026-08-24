import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "./lib/fs-utils.mjs";

async function read(relative) {
  return readFile(path.join(REPOSITORY_ROOT, relative), "utf8");
}

function parsedYaml(text) {
  const document = parseDocument(text);
  expect(document.errors).toEqual([]);
  return document.toJS();
}

describe("public repository content", () => {
  it("keeps the bilingual READMEs linked with existing, labeled images", async () => {
    const english = await read("README.md");
    const chinese = await read("README.zh-CN.md");
    expect(english).toContain("README.zh-CN.md");
    expect(chinese).toContain("README.md");
    for (const markdown of [english, chinese]) {
      const images = [...markdown.matchAll(/!\[([^\]]+)\]\(([^)]+)\)/g)];
      expect(images.length).toBeGreaterThanOrEqual(5);
      for (const [, alt, target] of images) {
        expect(alt.trim()).not.toBe("");
        if (/^https?:\/\//.test(target)) continue;
        expect((await stat(path.join(REPOSITORY_ROOT, target))).isFile()).toBe(true);
      }
    }
  });

  it("marks all public demo inputs as synthetic", async () => {
    const data = JSON.parse(await read("fixtures/public-demo/demo-data.json"));
    const manifest = JSON.parse(await read("public/demo/manifest.json"));
    expect(data.synthetic).toBe(true);
    expect(manifest.synthetic).toBe(true);
    expect(data.notice).toMatch(/fictional/i);
    expect(manifest.notice).toMatch(/fictional/i);
    expect(manifest.files).toHaveLength(4);
    for (const entry of manifest.files) {
      expect(entry.name).toMatch(/\.png$/);
      expect(entry.bytes).toBeGreaterThan(100);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await stat(path.join(REPOSITORY_ROOT, "public", "demo", entry.name))).size).toBe(
        entry.bytes,
      );
    }
  });

  it("ignores release ZIPs while keeping checksum manifests publishable", async () => {
    const gitignore = await read(".gitignore");
    expect(gitignore).toContain("release/*.zip");
    expect(gitignore).not.toMatch(/^release\/$/m);
  });

  it("keeps generated text stable across operating systems", async () => {
    const attributes = await read(".gitattributes");
    expect(attributes).toMatch(/^\* text=auto eol=lf$/m);
    for (const extension of [
      "gif",
      "gz",
      "ico",
      "jpeg",
      "jpg",
      "png",
      "wasm",
      "webp",
      "woff2",
      "zip",
    ])
      expect(attributes).toMatch(new RegExp(`^\\*\\.${extension} binary$`, "m"));
  });

  it("records the confirmed MIT license and public repository intent", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const packageLock = JSON.parse(await read("package-lock.json"));
    const license = await read("LICENSE");
    const confirmations = await read("RELEASE_BLOCKERS.md");
    const settings = await read("docs/repository-settings.md");

    expect(packageJson.license).toBe("MIT");
    expect(packageLock.packages[""].license).toBe("MIT");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 xin");
    expect(confirmations).not.toMatch(/^\s*-\s*\[ \]/m);
    expect(settings).toContain("`snap2cal`");
    expect(settings).toContain("`public`");
  });

  it("uses the confirmed GitHub repository metadata", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const readmes = [await read("README.md"), await read("README.zh-CN.md")];

    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/wxgith/snap2cal.git",
    });
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/wxgith/snap2cal/issues",
    });
    expect(packageJson.homepage).toBe("https://wxgith.github.io/snap2cal/");
    for (const readme of readmes) {
      expect(readme).toContain("github.com/wxgith/snap2cal/actions/workflows/ci.yml");
      expect(readme).toContain(
        "github.com/wxgith/snap2cal/actions/workflows/full-verification.yml",
      );
      expect(readme).toContain("github.com/wxgith/snap2cal/actions/workflows/pages.yml");
      expect(readme).toContain("github.com/wxgith/snap2cal/security/policy");
      expect(readme).toContain("https://wxgith.github.io/snap2cal/");
    }
  });

  it("provides parseable Issue Forms with required privacy confirmation", async () => {
    const expectedIds = {
      "bug-report.yml": [
        "version",
        "mode",
        "browser",
        "operating-system",
        "reproduction",
        "expected",
        "actual",
        "privacy",
      ],
      "ocr-problem.yml": [
        "image-type",
        "dimensions",
        "language",
        "incorrect-text",
        "synthetic-example",
        "privacy",
      ],
      "feature-request.yml": [
        "problem",
        "workaround",
        "existing-modes",
        "data-boundary",
        "privacy-impact",
        "fixture-contribution",
        "privacy",
      ],
    };
    for (const [name, ids] of Object.entries(expectedIds)) {
      const parsed = parsedYaml(await read(`.github/ISSUE_TEMPLATE/${name}`));
      const bodyIds = parsed.body.map((item) => item.id).filter(Boolean);
      expect(bodyIds).toEqual(expect.arrayContaining(ids));
      const privacy = parsed.body.find((item) => item.id === "privacy");
      expect(privacy.attributes.options.some((option) => option.required === true)).toBe(true);
    }
    const config = parsedYaml(await read(".github/ISSUE_TEMPLATE/config.yml"));
    expect(config.blank_issues_enabled).toBe(false);
    expect(config.contact_links.some((link) => link.url.includes("security/policy"))).toBe(true);
  });

  it("uses only version-tagged official Actions and minimum top-level permissions", async () => {
    for (const name of ["ci.yml", "full-verification.yml", "pages.yml", "release.yml"]) {
      const text = await read(`.github/workflows/${name}`);
      const parsed = parsedYaml(text);
      expect(parsed.permissions).toEqual({ contents: "read" });
      expect(text).not.toContain("pull_request_target");
      expect(text).not.toContain("write-all");
      expect(text).not.toMatch(/uses:\s*[^\s]+@main/);
      for (const match of text.matchAll(/uses:\s*([^\s]+)@([^\s]+)/g)) {
        expect(match[1].startsWith("actions/")).toBe(true);
        expect(match[2]).toMatch(/^v\d+(?:\.\d+){0,2}$/);
      }
    }
  });
});
