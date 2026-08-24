import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import {
  isMainModule,
  listFiles,
  parseCliArguments,
  pathExists,
  relativePath,
  reportValidation,
  REPOSITORY_ROOT,
} from "./lib/fs-utils.mjs";

const execFileAsync = promisify(execFile);

export const REQUIRED_REPOSITORY_FILES = [
  ".gitignore",
  ".node-version",
  "README.md",
  "README.zh-CN.md",
  "RELEASE_BLOCKERS.md",
  "THIRD_PARTY_NOTICES.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "ROADMAP.md",
  "CHANGELOG.md",
  "RELEASE_CHECKLIST.md",
  "package.json",
  "package-lock.json",
  "config/bundle-budgets.json",
  "docs/dependency-licenses.md",
  "docs/privacy.md",
  "docs/repository-settings.md",
  "docs/release-process.md",
  "docs/manual-release-test.md",
  "docs/github-labels.md",
  "docs/release-archive.md",
  "fixtures/public-demo/README.md",
  "fixtures/public-demo/demo-data.json",
  "public/demo/manifest.json",
  "public/demo/single-event.png",
  "public/demo/multi-event.png",
  "public/demo/timetable.png",
  "public/demo/shift-roster.png",
  "docs/images/text-event-result.png",
  "docs/images/ocr-evidence.png",
  "docs/images/timetable-grid.png",
  "docs/images/shift-roster-matrix.png",
  "docs/images/shift-roster-mobile-390.png",
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/ocr-problem.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/pull_request_template.md",
  ".github/dependabot.yml",
  ".github/release.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/full-verification.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/release.yml",
];

const REQUIRED_SCRIPTS = [
  "capture:demo",
  "generate:license-report",
  "package:release",
  "test:a11y",
  "test:cross-browser",
  "validate:dist",
  "validate:production-mocks",
  "validate:release",
  "validate:repo",
  "validate:runtime-network",
  "verify:pages-base",
];

const SCAN_EXCLUDED_NAMES = new Set([
  ".git",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "release",
  "test-results",
]);

const TEXT_EXTENSIONS = new Set([
  "",
  ".css",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SECRET_PATTERNS = [
  ["OpenAI-style key", /sk-[A-Za-z0-9_-]{20,}/g],
  ["GitHub classic token", /ghp_[A-Za-z0-9]{20,}/g],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{20,}/g],
  ["Authorization bearer value", /Bearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/gi],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["client secret assignment", /client[_-]?secret\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi],
  ["API key assignment", /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi],
  ["access token assignment", /access[_-]?token\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi],
  ["refresh token assignment", /refresh[_-]?token\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/gi],
];

const PERSONAL_PATH_PATTERNS = [
  ["Windows user profile", /[A-Za-z]:(?:[\\/]|\\\\)Users(?:[\\/]|\\\\)[^\\/\s]+(?:[\\/]|\\\\)/i],
  ["Windows user profile without drive", /\\Users\\[^\\\s]+\\/i],
  ["POSIX home directory", /\/home\/(?!<)[^/\s]+\//i],
  ["workspace marker", /Documents[\\/]ChatGPT/i],
  ["known local dev port", /127\.0\.0\.1:(?:5173|5180)\b/],
  ["local file Markdown link", /\]\(\s*file:\/\//i],
];

function addIssue(collection, message) {
  if (!collection.includes(message)) collection.push(message);
}

async function collectTrackedFiles(root) {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout
      .split("\0")
      .filter(Boolean)
      .map((value) => value.replaceAll("\\", "/"));
  } catch {
    return [];
  }
}

async function collectTextFiles(root) {
  const files = await listFiles(root, { excludedNames: [...SCAN_EXCLUDED_NAMES] });
  return files.filter((file) => {
    const relative = relativePath(root, file);
    if (relative.startsWith("public/ocr/")) return false;
    if (path.basename(file).startsWith(".env")) return false;
    const extension = path.extname(file).toLowerCase();
    return TEXT_EXTENSIONS.has(extension) || path.basename(file) === ".gitignore";
  });
}

function markdownTargets(markdown) {
  const links = [];
  const expression = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(expression)) {
    let target = match[3].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    const titleStart = target.search(/\s+["']/);
    if (titleStart >= 0) target = target.slice(0, titleStart);
    links.push({ image: match[1] === "!", alt: match[2].trim(), target });
  }
  return links;
}

function resolveMarkdownTarget(markdownPath, target) {
  if (/^(?:https?:|mailto:|#)/i.test(target)) return null;
  const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
  if (!withoutFragment) return null;
  try {
    return path.resolve(path.dirname(markdownPath), decodeURIComponent(withoutFragment));
  } catch {
    return path.resolve(path.dirname(markdownPath), withoutFragment);
  }
}

function detectLicense(content) {
  if (/MIT License/i.test(content) && /permission is hereby granted/i.test(content)) return "MIT";
  if (/Apache License\s+Version 2\.0/i.test(content)) return "Apache-2.0";
  if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(content)) return "GPL-3.0";
  if (/Mozilla Public License\s+Version 2\.0/i.test(content)) return "MPL-2.0";
  return "UNKNOWN";
}

function parseUncheckedBlockers(markdown) {
  return [...markdown.matchAll(/^\s*-\s*\[ \]\s+(.+)$/gim)].map((match) => match[1].trim());
}

function yamlObject(text, source, errors) {
  const document = parseDocument(text, { prettyErrors: false });
  if (document.errors.length) {
    addIssue(errors, `${source} is not valid YAML.`);
    return null;
  }
  return document.toJS();
}

function checkActionWorkflow(relative, text, parsed, errors) {
  if (!relative.startsWith(".github/workflows/")) return;
  if (!parsed || typeof parsed !== "object") return;
  if (!("permissions" in parsed)) addIssue(errors, `${relative} has no top-level permissions.`);
  if (/pull_request_target\s*:/i.test(text))
    addIssue(errors, `${relative} uses pull_request_target.`);
  if (/\bwrite-all\b/i.test(text)) addIssue(errors, `${relative} uses write-all permission.`);
  if (/runs-on:\s*self-hosted/i.test(text))
    addIssue(errors, `${relative} uses a self-hosted runner.`);
  if (/uses:\s*[^\s]+@main\b/i.test(text)) addIssue(errors, `${relative} uses an Action at @main.`);
  if (/\bnpm install\b/.test(text))
    addIssue(errors, `${relative} uses npm install instead of npm ci.`);

  for (const match of text.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g)) {
    const action = match[1];
    const reference = match[2].replace(/["']/g, "");
    if (!action.startsWith("actions/"))
      addIssue(errors, `${relative} uses non-official Action ${action}.`);
    if (!/^v\d+(?:\.\d+){0,2}$/.test(reference))
      addIssue(errors, `${relative} does not use a stable version tag for ${action}.`);
  }
}

function checkIssueForm(relative, parsed, errors) {
  if (!relative.startsWith(".github/ISSUE_TEMPLATE/") || !relative.endsWith(".yml")) return;
  if (relative.endsWith("config.yml")) {
    const links = parsed?.contact_links;
    if (
      !Array.isArray(links) ||
      !links.some((link) => String(link?.url).includes("security/policy"))
    )
      addIssue(errors, `${relative} does not redirect security reports to the security policy.`);
    return;
  }
  if (!Array.isArray(parsed?.body)) {
    addIssue(errors, `${relative} has no Issue Form body.`);
    return;
  }
  const privacy = parsed.body.find((item) => item?.id === "privacy");
  const options = privacy?.attributes?.options;
  if (!Array.isArray(options) || !options.some((option) => option?.required === true))
    addIssue(errors, `${relative} has no required privacy confirmation.`);
}

export async function validateRepository(options = {}) {
  const root = path.resolve(options.root ?? REPOSITORY_ROOT);
  const errors = [];
  const warnings = [];
  const blockers = [];
  const requiredFiles = options.requiredFiles ?? REQUIRED_REPOSITORY_FILES;

  for (const relative of requiredFiles) {
    if (!(await pathExists(path.join(root, relative))))
      addIssue(errors, `Missing required file: ${relative}`);
  }

  const trackedFiles = options.trackedFiles ?? (await collectTrackedFiles(root));
  for (const tracked of trackedFiles) {
    const normalized = tracked.replaceAll("\\", "/");
    if (normalized === "node_modules" || normalized.startsWith("node_modules/"))
      addIssue(errors, `Generated dependency path is tracked: ${normalized}`);
    if (normalized === "dist" || normalized.startsWith("dist/"))
      addIssue(errors, `Generated production path is tracked: ${normalized}`);
    if (path.basename(normalized).startsWith(".env"))
      addIssue(errors, `Environment file is tracked: ${normalized}`);
  }
  if (!trackedFiles.length)
    addIssue(warnings, "Git has no tracked files yet; validate again after the initial commit.");

  const textFiles = await collectTextFiles(root);
  const textByRelative = new Map();
  for (const file of textFiles) {
    const relative = relativePath(root, file);
    const text = await readFile(file, "utf8");
    textByRelative.set(relative, text);
    for (const [label, expression] of PERSONAL_PATH_PATTERNS) {
      expression.lastIndex = 0;
      if (expression.test(text)) addIssue(errors, `${relative} contains a ${label}.`);
    }
    for (const [label, expression] of SECRET_PATTERNS) {
      expression.lastIndex = 0;
      if (expression.test(text))
        addIssue(errors, `${relative} contains a suspected ${label}; value redacted.`);
    }
    if (/SNAP2CAL[_-]PRIVATE[_-]FIXTURE|DEMO[_-]CONTAINS[_-]REAL[_-]DATA/i.test(text))
      addIssue(errors, `${relative} contains an unredacted-demo marker.`);
  }

  for (const [relative, markdown] of textByRelative) {
    if (!relative.endsWith(".md")) continue;
    const markdownPath = path.join(root, relative);
    for (const link of markdownTargets(markdown)) {
      if (link.image && !link.alt)
        addIssue(errors, `${relative} contains an image without alt text.`);
      const targetPath = resolveMarkdownTarget(markdownPath, link.target);
      if (targetPath && !(await pathExists(targetPath)))
        addIssue(errors, `${relative} links to missing path ${link.target}.`);
    }
  }

  for (const [relative, text] of textByRelative) {
    if (relative.endsWith(".json")) {
      try {
        JSON.parse(text);
      } catch {
        addIssue(errors, `${relative} is not valid JSON.`);
      }
    }
    if (relative.endsWith(".yml") || relative.endsWith(".yaml")) {
      const parsed = yamlObject(text, relative, errors);
      checkActionWorkflow(relative, text, parsed, errors);
      checkIssueForm(relative, parsed, errors);
    }
  }

  const packagePath = path.join(root, "package.json");
  let packageJson;
  if (await pathExists(packagePath)) {
    try {
      packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    } catch {
      addIssue(errors, "package.json is not valid JSON.");
    }
  }
  if (packageJson) {
    if (packageJson.private !== true) addIssue(errors, "package.json must keep private: true.");
    if (!packageJson.version) addIssue(errors, "package.json has no version.");
    if (!packageJson.description) addIssue(errors, "package.json has no description.");
    if (!packageJson.engines?.node)
      addIssue(errors, "package.json has no engines.node constraint.");
    if (!packageJson.packageManager) addIssue(errors, "package.json has no packageManager value.");
    for (const script of REQUIRED_SCRIPTS) {
      if (!packageJson.scripts?.[script])
        addIssue(errors, `package.json is missing script ${script}.`);
    }
    const readmeCommands = [
      ...(textByRelative.get("README.md") ?? "").matchAll(/npm run ([a-z0-9:-]+)/gi),
    ].map((match) => match[1]);
    for (const command of readmeCommands) {
      if (!packageJson.scripts?.[command])
        addIssue(errors, `README.md references missing npm script ${command}.`);
    }
    const nodeVersion = (textByRelative.get(".node-version") ?? "").trim();
    if (nodeVersion && !String(packageJson.engines?.node ?? "").includes(nodeVersion))
      addIssue(errors, "package.json engines.node does not match .node-version.");
    const changelog = textByRelative.get("CHANGELOG.md") ?? "";
    if (packageJson.version && !changelog.includes(`## ${packageJson.version}`))
      addIssue(errors, `CHANGELOG.md has no section for package version ${packageJson.version}.`);
  }

  const blockerText = textByRelative.get("RELEASE_BLOCKERS.md") ?? "";
  for (const blocker of parseUncheckedBlockers(blockerText)) addIssue(blockers, blocker);
  const licensePath = path.join(root, "LICENSE");
  const hasLicense = await pathExists(licensePath);
  if (!hasLicense) {
    if (!blockers.some((item) => /open-source license/i.test(item)))
      addIssue(errors, "LICENSE is missing without an open-source-license blocker.");
    else addIssue(warnings, "LICENSE is absent and covered by the open-source-license blocker.");
    if (packageJson?.license !== "UNLICENSED")
      addIssue(errors, "package.json must use UNLICENSED while LICENSE is absent.");
  } else {
    const detected = detectLicense(await readFile(licensePath, "utf8"));
    if (detected === "UNKNOWN") addIssue(errors, "LICENSE text could not be identified.");
    if (packageJson?.license !== detected)
      addIssue(
        errors,
        `package.json license ${packageJson?.license ?? "missing"} does not match ${detected}.`,
      );
    if (blockers.some((item) => /open-source license/i.test(item)))
      addIssue(errors, "LICENSE exists but the open-source-license blocker is still unchecked.");
  }

  if (packageJson?.version === "1.0.0" && blockers.length)
    addIssue(errors, "package.json claims 1.0.0 while release blockers remain unchecked.");

  const englishReadme = textByRelative.get("README.md") ?? "";
  const chineseReadme = textByRelative.get("README.zh-CN.md") ?? "";
  if (!englishReadme.includes("README.zh-CN.md"))
    addIssue(errors, "README.md has no Chinese README link.");
  if (!chineseReadme.includes("README.md"))
    addIssue(errors, "README.zh-CN.md has no English README link.");
  if (!hasLicense) {
    if (!englishReadme.includes("UNLICENSED") || !chineseReadme.includes("UNLICENSED"))
      addIssue(errors, "Both READMEs must disclose the UNLICENSED state.");
  }

  const demoDataPath = path.join(root, "fixtures", "public-demo", "demo-data.json");
  if (await pathExists(demoDataPath)) {
    try {
      const data = JSON.parse(await readFile(demoDataPath, "utf8"));
      if (data.synthetic !== true) addIssue(errors, "Public demo data is not marked synthetic.");
    } catch {
      // JSON syntax is reported above.
    }
  }
  const demoManifestPath = path.join(root, "public", "demo", "manifest.json");
  if (await pathExists(demoManifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(demoManifestPath, "utf8"));
      if (manifest.synthetic !== true)
        addIssue(errors, "Public demo manifest is not marked synthetic.");
    } catch {
      // JSON syntax is reported above.
    }
  }
  for (const [relative, text] of textByRelative) {
    if (!relative.startsWith("fixtures/public-demo/") && !relative.startsWith("public/demo/"))
      continue;
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text))
      addIssue(errors, `${relative} contains an email-like value.`);
    if (/(?:^|\D)1[3-9]\d{9}(?:\D|$)/.test(text))
      addIssue(errors, `${relative} contains a phone-like value.`);
  }

  const gitignore = textByRelative.get(".gitignore") ?? "";
  for (const expected of ["node_modules/", "dist/", "public/ocr/", ".env*"]) {
    if (!gitignore.includes(expected)) addIssue(errors, `.gitignore is missing ${expected}.`);
  }

  if (options.requirePublishable && blockers.length) {
    for (const blocker of blockers) addIssue(errors, `Publishable validation blocked: ${blocker}`);
  }

  for (const collection of [errors, warnings, blockers])
    collection.sort((a, b) => a.localeCompare(b, "en"));
  return { errors, warnings, blockers };
}

if (isMainModule(import.meta.url)) {
  const argumentsMap = parseCliArguments(process.argv.slice(2));
  try {
    const result = await validateRepository({
      requirePublishable: argumentsMap.has("--require-publishable"),
    });
    if (!reportValidation("Repository validation", result)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
