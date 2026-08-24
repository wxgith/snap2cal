import { describe, expect, it } from "vitest";
import { createOcrAssetManifest, removeRemoteOcrFallbacks } from "./lib/ocr-assets.mjs";

describe("OCR asset preparation", () => {
  it("creates a deterministic manifest without build timestamps", () => {
    const files = [{ path: "worker.min.js", bytes: 3, sha256: "abc" }];

    expect(createOcrAssetManifest(files)).toEqual({
      engine: "tesseract.js",
      engineVersion: "7.0.0",
      languageData: "tessdata.projectnaptha.com/4.0.0_fast",
      files,
    });
    expect(JSON.stringify(createOcrAssetManifest(files))).not.toContain("generatedAt");
  });

  it("replaces Worker CDN defaults with local failure sentinels", () => {
    const worker = [
      "https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim/4.0.0",
      "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7/core.js",
    ].join("\n");
    const rewritten = removeRemoteOcrFallbacks(worker);
    expect(rewritten).not.toContain("cdn.jsdelivr.net");
    expect(rewritten).toContain("./__snap2cal_language_path_required__/");
    expect(rewritten).toContain("./__snap2cal_core_path_required__/v7/core.js");
  });

  it("fails loudly if an upstream Worker no longer has the expected fallbacks", () => {
    expect(() => removeRemoteOcrFallbacks("self.onmessage = () => {}")).toThrowError(
      /Expected Tesseract Worker fallback is missing/,
    );
  });
});
