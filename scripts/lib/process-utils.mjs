import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { REPOSITORY_ROOT } from "./fs-utils.mjs";

export function runCommand(command, argumentsList, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else
        reject(
          new Error(
            `${path.basename(command)} exited ${signal ? `after ${signal}` : `with code ${code}`}.`,
          ),
        );
    });
  });
}

export function spawnNode(script, argumentsList = [], options = {}) {
  const child = spawn(process.execPath, [script, ...argumentsList], {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
}

export function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error("Could not allocate a local port."));
        else resolve(port);
      });
    });
  });
}

export async function waitForUrl(url, child, timeout = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (child?.exitCode !== null)
      throw new Error(`Local server exited before becoming ready at ${url}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

export function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}

export function viteBin(root = REPOSITORY_ROOT) {
  return path.join(root, "node_modules", "vite", "bin", "vite.js");
}

export function playwrightBin(root = REPOSITORY_ROOT) {
  return path.join(root, "node_modules", "@playwright", "test", "cli.js");
}
