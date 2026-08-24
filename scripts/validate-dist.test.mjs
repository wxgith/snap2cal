import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createValidDist } from "./__tests__/test-fixtures.mjs";
import { validateDist } from "./validate-dist.mjs";

const roots = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "snap2cal-dist-validator-"));
  roots.push(root);
  await createValidDist(root);
  return root;
}

async function validate(root) {
  return validateDist({
    root,
    distPath: path.join(root, "dist"),
    budgetsPath: path.join(root, "config", "bundle-budgets.json"),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("dist validator", () => {
  it("accepts a complete synthetic production dist", async () => {
    expect((await validate(await fixtureRoot())).errors).toEqual([]);
  });

  it("reports a missing index", async () => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "dist", "index.html"));
    expect((await validate(root)).errors).toContain("dist/index.html is missing.");
  });

  it.each([
    ["OCR Worker", "ocr/worker.min.js", "dist is missing ocr/worker.min.js."],
    ["WASM", "ocr/core/tesseract-core.wasm", "dist is missing an OCR WASM core."],
    [
      "Chinese language",
      "ocr/lang/chi_sim.traineddata.gz",
      "dist is missing ocr/lang/chi_sim.traineddata.gz.",
    ],
    [
      "English language",
      "ocr/lang/eng.traineddata.gz",
      "dist is missing ocr/lang/eng.traineddata.gz.",
    ],
    [
      "dynamic timetable",
      "assets/ScheduleTableWorkspace-one.js",
      "dist is missing the scheduleTable JavaScript chunk.",
    ],
  ])("reports a missing %s resource", async (_label, relative, expected) => {
    const root = await fixtureRoot();
    await unlink(path.join(root, "dist", relative));
    expect((await validate(root)).errors).toContain(expected);
  });

  it("rejects a production Mock identifier", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, "dist", "assets", "index-main.js"),
      "new MockOcrAdapter()",
      "utf8",
    );
    expect((await validate(root)).errors.some((error) => error.includes("MockOcrAdapter"))).toBe(
      true,
    );
  });

  it("rejects localhost and third-party OCR URLs", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, "dist", "assets", "index-main.js"),
      "const a='http://127.0.0.1:9999'; const b='https://tessdata.projectnaptha.com/file'",
      "utf8",
    );
    const result = await validate(root);
    expect(result.errors.some((error) => error.includes("localhost URL"))).toBe(true);
    expect(result.errors.some((error) => error.includes("tessdata.projectnaptha.com"))).toBe(true);
  });

  it("rejects an embedded developer path", async () => {
    const root = await fixtureRoot();
    const personalPath = "C:" + "\\Users\\example-user\\source.ts";
    await writeFile(
      path.join(root, "dist", "assets", "index-main.js"),
      JSON.stringify(personalPath),
    );
    expect((await validate(root)).errors.some((error) => error.includes("developer path"))).toBe(
      true,
    );
  });

  it("enforces the main bundle budget", async () => {
    const root = await fixtureRoot();
    const budgetPath = path.join(root, "config", "bundle-budgets.json");
    const budgets = JSON.parse(await readFile(budgetPath, "utf8"));
    budgets.main.rawBytes = 1;
    await writeFile(budgetPath, JSON.stringify(budgets), "utf8");
    expect(
      (await validate(root)).errors.some((error) => error.includes("Main bundle raw size")),
    ).toBe(true);
  });
});
