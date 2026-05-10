import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (nodeMajor < 22) {
  console.error(
    `Node.js 22+ required. Current: ${process.versions.node}. (Tip: nvm use)`
  );
  process.exit(1);
}

const envExamplePath = path.join(projectRoot, ".env.example");
const envLocalPath = path.join(projectRoot, ".env.local");

try {
  await fs.access(envLocalPath);
} catch {
  try {
    await fs.copyFile(envExamplePath, envLocalPath);
    console.log("Created .env.local from .env.example");
  } catch (error) {
    console.warn(
      "Failed to create .env.local automatically. Please copy .env.example manually.",
      error
    );
  }
}

console.log("Next steps:");
console.log("- npm install");
console.log("- Run `npx @openai/codex login` once if Codex is not logged in");
console.log("- Add GEMINI_API_KEY to .env.local for planning/text generation");
console.log("- npm run security:check before publishing or opening a PR");
console.log("- npm run dev (starts local backend + Vite)");
