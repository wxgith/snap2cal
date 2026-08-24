import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  assertNoSymlinks,
  formatBytes,
  isInside,
  isMainModule,
  listFiles,
  parseCliArguments,
  pathExists,
  relativePath,
  REPOSITORY_ROOT,
  sha256,
} from "./lib/fs-utils.mjs";
import { validateDist } from "./validate-dist.mjs";
import { validateProductionMocks } from "./validate-production-mocks.mjs";
import { validateRepository } from "./validate-repo.mjs";

const FIXED_MTIME = new Date("2000-01-01T00:00:00.000Z");
const ALREADY_COMPRESSED = new Set([".gz", ".jpeg", ".jpg", ".png", ".wasm", ".webp", ".zip"]);

function zipEntry(data, name) {
  return [
    data instanceof Uint8Array ? data : new Uint8Array(data),
    { level: ALREADY_COMPRESSED.has(path.extname(name).toLowerCase()) ? 0 : 6, mtime: FIXED_MTIME },
  ];
}

function assertValidation(result, label) {
  if (result.errors.length) throw new Error(`${label}: ${result.errors.join(" | ")}`);
}

export async function packageRelease(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const distPath = path.resolve(options.distPath ?? path.join(root, "dist"));
  const releasePath = path.resolve(options.releasePath ?? path.join(root, "release"));
  if (!isInside(root, releasePath) || releasePath === root)
    throw new Error("Release output must be a dedicated directory inside the repository root.");

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const version = packageJson.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`Invalid package version: ${version}`);
  if (options.tag && options.tag !== `v${version}`)
    throw new Error(`Tag ${options.tag} does not match package version v${version}.`);

  const repository = await validateRepository({
    root,
    requirePublishable: options.requirePublishable === true,
    requiredFiles: options.requiredFiles,
    trackedFiles: options.trackedFiles,
  });
  assertValidation(repository, "Repository validation failed before packaging");
  const dist = await validateDist({ root, distPath });
  assertValidation(dist, "Dist validation failed before packaging");
  const mocks = await validateProductionMocks({ root, distPath });
  assertValidation(mocks, "Production Mock validation failed before packaging");
  await assertNoSymlinks(distPath);

  const hasLicense = await pathExists(path.join(root, "LICENSE"));
  if (options.requirePublishable && !hasLicense)
    throw new Error("A publishable release archive requires LICENSE.");

  await mkdir(releasePath, { recursive: true });
  const zipName = `snap2cal-v${version}-static-site.zip`;
  const checksumName = `snap2cal-v${version}-SHA256SUMS.txt`;
  const zipPath = path.join(releasePath, zipName);
  const checksumPath = path.join(releasePath, checksumName);
  for (const target of [zipPath, checksumPath]) {
    if (!isInside(releasePath, target))
      throw new Error("Refusing to remove release output outside release/.");
    await rm(target, { force: true });
  }

  const archiveRoot = `snap2cal-v${version}`;
  const entries = {};
  for (const file of await listFiles(distPath)) {
    const details = await lstat(file);
    if (!details.isFile()) throw new Error(`Release input is not a regular file: ${file}`);
    const relative = relativePath(distPath, file);
    entries[`${archiveRoot}/${relative}`] = zipEntry(await readFile(file), relative);
  }

  entries[`${archiveRoot}/README.txt`] = zipEntry(
    strToU8(await readFile(path.join(root, "docs", "release-archive.md"), "utf8")),
    "README.txt",
  );
  entries[`${archiveRoot}/THIRD_PARTY_NOTICES.md`] = zipEntry(
    await readFile(path.join(root, "THIRD_PARTY_NOTICES.md")),
    "THIRD_PARTY_NOTICES.md",
  );
  const publishable = hasLicense && repository.blockers.length === 0;
  entries[`${archiveRoot}/VERSION.txt`] = zipEntry(
    strToU8(
      `Snap2Cal ${version}\nArchive status: ${publishable ? "publishable checks passed" : "preview only; see RELEASE_BLOCKERS.md"}\n`,
    ),
    "VERSION.txt",
  );
  if (hasLicense) {
    entries[`${archiveRoot}/LICENSE`] = zipEntry(
      await readFile(path.join(root, "LICENSE")),
      "LICENSE",
    );
  }
  if (!publishable) {
    entries[`${archiveRoot}/RELEASE_BLOCKERS.md`] = zipEntry(
      await readFile(path.join(root, "RELEASE_BLOCKERS.md")),
      "RELEASE_BLOCKERS.md",
    );
  }

  const archive = zipSync(entries, { level: 6 });
  await writeFile(zipPath, archive);
  const digest = sha256(archive);
  await writeFile(checksumPath, `${digest}  ${zipName}\n`, "utf8");
  console.log(
    `Created ${zipName} (${formatBytes(archive.length)}) and ${checksumName}; status: ${publishable ? "publishable checks passed" : "preview only with known blockers"}.`,
  );
  return {
    version,
    archiveRoot,
    zipName,
    zipPath,
    checksumName,
    checksumPath,
    sha256: digest,
    bytes: archive.length,
    blockers: repository.blockers,
    publishable,
  };
}

if (isMainModule(import.meta.url)) {
  const argumentsMap = parseCliArguments(process.argv.slice(2));
  try {
    await packageRelease({
      requirePublishable: argumentsMap.has("--require-publishable"),
      tag: argumentsMap.get("--tag"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
