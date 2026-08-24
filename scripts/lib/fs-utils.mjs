import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function listFiles(directory, options = {}) {
  const root = path.resolve(directory);
  const excludedNames = new Set(options.excludedNames ?? []);
  const files = [];

  async function visit(current) {
    if (!(await pathExists(current))) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (excludedNames.has(entry.name)) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        if (options.includeSymlinks) files.push(entryPath);
      } else if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export async function listEntries(directory) {
  const root = path.resolve(directory);
  const entries = [];

  async function visit(current) {
    if (!(await pathExists(current))) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      entries.push({ path: entryPath, type: entry.isDirectory() ? "directory" : "file" });
      if (entry.isDirectory()) await visit(entryPath);
    }
  }

  await visit(root);
  return entries;
}

export async function directorySize(directory) {
  let bytes = 0;
  for (const file of await listFiles(directory)) bytes += (await stat(file)).size;
  return bytes;
}

export function relativePath(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

export function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

export function parseCliArguments(argumentsList) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) continue;
    const equalsIndex = argument.indexOf("=");
    if (equalsIndex >= 0) {
      values.set(argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1));
    } else if (argumentsList[index + 1] && !argumentsList[index + 1].startsWith("--")) {
      values.set(argument, argumentsList[index + 1]);
      index += 1;
    } else {
      flags.add(argument);
    }
  }
  return {
    has: (name) => flags.has(name) || values.has(name),
    get: (name) => values.get(name),
  };
}

export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  return metaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}

export async function assertNoSymlinks(directory) {
  for (const entry of await listEntries(directory)) {
    const details = await lstat(entry.path);
    if (details.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${entry.path}`);
  }
}

export function reportValidation(title, result, options = {}) {
  for (const warning of result.warnings ?? []) console.warn(`WARNING: ${warning}`);
  for (const blocker of result.blockers ?? []) console.warn(`BLOCKER: ${blocker}`);
  for (const error of result.errors ?? []) console.error(`ERROR: ${error}`);

  if (result.errors?.length) {
    console.error(`${title} failed with ${result.errors.length} error(s).`);
    return false;
  }

  const blockerCount = result.blockers?.length ?? 0;
  console.log(
    blockerCount
      ? `${title} passed for release engineering with ${blockerCount} known blocker(s); it is not publishable.`
      : `${title} passed with no known blocker.`,
  );
  if (options.summary) console.log(options.summary);
  return true;
}
