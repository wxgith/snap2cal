import { isMainModule } from "./lib/fs-utils.mjs";

const SEMVER_TAG =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function releaseTagMetadata(tag, packageVersion) {
  const expectedTag = `v${packageVersion}`;
  if (tag !== expectedTag) throw new Error(`Tag ${tag} must equal package version ${expectedTag}.`);

  const match = SEMVER_TAG.exec(tag);
  if (!match) throw new Error(`Tag ${tag} is not a supported SemVer release tag.`);

  return {
    tag,
    packageVersion,
    channel: match[1] ? "prerelease" : "stable",
  };
}

if (isMainModule(import.meta.url)) {
  const [tag, packageVersion] = process.argv.slice(2);
  try {
    if (!tag || !packageVersion)
      throw new Error("Usage: node scripts/release-tag.mjs <tag> <package-version>");
    console.log(releaseTagMetadata(tag, packageVersion).channel);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
