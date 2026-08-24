import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

const root = process.cwd();
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const playwrightCli = join(root, "node_modules", "@playwright", "test", "cli.js");

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error("Could not allocate an E2E port."));
        else resolve(port);
      });
    });
  });
}

function startServer(port) {
  const server = spawn(
    process.execPath,
    [viteBin, "--mode", "e2e", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: root,
      env: { ...process.env, VITE_SNAP2CAL_MOCK_OCR: "true" },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  server.unref();
  return server;
}

function stopServer(server) {
  if (!server.pid || server.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    killer.unref();
  } else {
    server.kill("SIGTERM");
  }
}

async function waitForServer(server, url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (server.exitCode !== null) throw new Error("E2E dev server exited before it was ready.");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wait for Vite to bind the local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for E2E dev server.");
}

function runPlaywright(url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
      cwd: root,
      env: {
        ...process.env,
        SNAP2CAL_E2E_URL: url,
        SNAP2CAL_SKIP_WEB_SERVER: "true",
      },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 1);
    });
  });
}

const port = await findAvailablePort();
const url = `http://127.0.0.1:${port}`;
const server = startServer(port);
let exiting = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (exiting) return;
    exiting = true;
    stopServer(server);
    process.exit(1);
  });
}

try {
  await waitForServer(server, url);
  process.exitCode = await runPlaywright(url);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopServer(server);
}
