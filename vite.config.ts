import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("..") || /[?#]/.test(trimmed)) {
    throw new Error("VITE_BASE_PATH must be an absolute URL pathname without '..', '?' or '#'.");
  }
  return trimmed === "/" ? "/" : `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

function localTesseractDefaults() {
  return {
    name: "snap2cal-local-tesseract-defaults",
    enforce: "pre" as const,
    load(id: string) {
      const normalized = id.split("?", 1)[0].replaceAll("\\", "/");
      if (!normalized.endsWith("/tesseract.js/src/worker/browser/defaultOptions.js")) return null;
      return `'use strict'; module.exports = { workerBlobURL: true, logger: () => {}, workerPath: './ocr/worker.min.js' };`;
    },
  };
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH ?? "/"),
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(
      process.env.VITE_APP_VERSION?.trim() || packageJson.version,
    ),
  },
  plugins: [localTesseractDefaults(), react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
