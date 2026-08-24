import { defineConfig, devices } from "@playwright/test";

const skipWebServer = process.env.SNAP2CAL_SKIP_WEB_SERVER === "true";
const baseURL = process.env.SNAP2CAL_E2E_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "on-first-retry" },
  webServer: skipWebServer
    ? undefined
    : {
        command: "node ./node_modules/vite/bin/vite.js --mode e2e --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        env: { VITE_SNAP2CAL_MOCK_OCR: "true" },
      },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
