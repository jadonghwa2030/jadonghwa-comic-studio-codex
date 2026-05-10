import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const root = process.cwd();
const envLocalPath = path.join(root, ".env.local");
const envExamplePath = path.join(root, ".env.example");

const checks = [];
const env = loadEnv();

const localApiPort = env.LOCAL_API_PORT || process.env.LOCAL_API_PORT || "8787";
const localApiHost = env.LOCAL_API_HOST || process.env.LOCAL_API_HOST || "127.0.0.1";
const codexOAuthPort = env.CODEX_OAUTH_PROXY_PORT || process.env.CODEX_OAUTH_PROXY_PORT || "10531";
const healthUrl = `http://${localApiHost}:${localApiPort}/api/health`;
const codexModelsUrl = `http://127.0.0.1:${codexOAuthPort}/v1/models`;

await main();

async function main() {
  checkNode();
  checkPackageInstall();
  checkEnvFiles();
  checkGeminiKey();
  checkCodexCli();
  await checkHttp("Local API health", healthUrl, {
    ok: (json) => Boolean(json && typeof json === "object" && "gemini_api_configured" in json),
    onOk: (json) => {
      const gemini = json.gemini_api_configured ? "Gemini configured" : "Gemini missing";
      const oauth = json.codex_oauth_status || "unknown OAuth";
      const imageModel = json.codex_image_model ? `; image model ${json.codex_image_model}` : "";
      return `${gemini}; Codex OAuth ${oauth}${imageModel}`;
    },
    offlineHint: "Run `npm run dev` or `npm run dev:api` first."
  });
  await checkHttp("Codex OAuth proxy", codexModelsUrl, {
    ok: (json) => Boolean(json && Array.isArray(json.data)),
    onOk: (json) => `${json.data.length} model(s) visible`,
    offlineHint: "Run `npx @openai/codex login`, then start the app with `npm run dev`."
  });

  printReport();
}

function loadEnv() {
  if (fs.existsSync(envLocalPath)) {
    return dotenv.parse(fs.readFileSync(envLocalPath, "utf8"));
  }
  return {};
}

function checkNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  addCheck({
    name: "Node.js",
    status: major >= 22 ? "pass" : "fail",
    detail: `${process.versions.node}${major >= 22 ? "" : " (Node.js 22+ required)"}`
  });
}

function checkPackageInstall() {
  addCheck({
    name: "Dependencies",
    status: fs.existsSync(path.join(root, "node_modules")) ? "pass" : "warn",
    detail: fs.existsSync(path.join(root, "node_modules"))
      ? "node_modules found"
      : "Run `npm install`."
  });
}

function checkEnvFiles() {
  addCheck({
    name: ".env.example",
    status: fs.existsSync(envExamplePath) ? "pass" : "fail",
    detail: fs.existsSync(envExamplePath) ? "found" : "missing"
  });
  addCheck({
    name: ".env.local",
    status: fs.existsSync(envLocalPath) ? "pass" : "warn",
    detail: fs.existsSync(envLocalPath)
      ? "found"
      : "Run `npm run setup` or copy `.env.example` to `.env.local`."
  });
}

function checkGeminiKey() {
  const key = String(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  addCheck({
    name: "Gemini API key",
    status: key ? "pass" : "warn",
    detail: key ? "configured locally" : "Add `GEMINI_API_KEY` to `.env.local` for planning/script generation."
  });
}

function checkCodexCli() {
  const result = spawnSync("npx", ["@openai/codex", "--version"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000
  });
  addCheck({
    name: "Codex CLI",
    status: result.status === 0 ? "pass" : "warn",
    detail: result.status === 0
      ? (result.stdout || result.stderr || "available").trim()
      : "Could not run `npx @openai/codex --version`. Install/login may still work through npx."
  });
}

async function checkHttp(name, url, options) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Keep the original status detail below.
    }
    const ok = response.ok && options.ok(json);
    addCheck({
      name,
      status: ok ? "pass" : "warn",
      detail: ok ? options.onOk(json) : `Reached ${url}, but response was not healthy (${response.status}).`
    });
  } catch {
    addCheck({
      name,
      status: "warn",
      detail: `${url} is not reachable. ${options.offlineHint}`
    });
  }
}

function addCheck(check) {
  checks.push(check);
}

function printReport() {
  const icon = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL"
  };
  console.log("Jadonghwa Comic Studio for Codex doctor\n");
  for (const check of checks) {
    console.log(`[${icon[check.status]}] ${check.name}: ${check.detail}`);
  }

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  console.log("");
  if (failures.length > 0) {
    console.log("Doctor found blocking issues.");
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log("Doctor found warnings. The app may still run after you complete the noted setup steps.");
    return;
  }
  console.log("Doctor check passed. The local setup looks ready.");
}
