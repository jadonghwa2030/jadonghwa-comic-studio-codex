import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const runGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

const trackedFiles = runGit(["ls-files", "-z"])
  .split("\0")
  .filter(Boolean);

const failures = [];
const warnings = [];

const forbiddenTrackedPatterns = [
  { pattern: /^\.env$/, reason: "env files must stay local" },
  { pattern: /(^|\/)\.env\.(?!example$)[^/]+$/, reason: "env variants must stay local" },
  { pattern: /(^|\/)local-project-archive\//, reason: "local project archives contain user data" },
  { pattern: /(^|\/)(dist|node_modules|coverage)\//, reason: "generated dependency/build output" },
  { pattern: /(^|\/)(exports|outputs|uploads|generated)\//, reason: "generated or private user artifacts" },
  { pattern: /\.(zip|tar|tar\.gz|tgz)$/i, reason: "export archives should not be committed" }
];

for (const file of trackedFiles) {
  for (const rule of forbiddenTrackedPatterns) {
    if (rule.pattern.test(file)) {
      failures.push(`Tracked forbidden file: ${file} (${rule.reason})`);
    }
  }
}

const secretPatterns = [
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g },
  { name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g }
];

const textExtensions = new Set([
  ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);

for (const file of trackedFiles) {
  const absolute = path.join(root, file);
  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext)) continue;

  const text = fs.readFileSync(absolute, "utf8");
  for (const rule of secretPatterns) {
    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      failures.push(`Possible ${rule.name} in ${file}:${lineNumber(text, match.index ?? 0)}`);
    }
  }
}

const mustBeIgnored = [".env.local", "local-project-archive/projects.json"];
for (const file of mustBeIgnored) {
  try {
    runGit(["check-ignore", "-q", file]);
  } catch {
    failures.push(`Expected git to ignore ${file}`);
  }
}

if (fs.existsSync(path.join(root, ".env.local"))) {
  warnings.push(".env.local exists locally. Good for running, but never stage it.");
}

if (fs.existsSync(path.join(root, "local-project-archive", "projects.json"))) {
  warnings.push("local-project-archive/projects.json exists locally. Keep it private.");
}

if (failures.length > 0) {
  console.error("Security check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Security check passed.");
for (const warning of warnings) console.log(`- ${warning}`);

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}
