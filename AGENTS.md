## Workspace Local Skills

This workspace uses local skills stored inside `./skills`.

For this workspace, prefer local skills over globally installed skills when both exist.

### Available workspace local skills

- `codex-subagent-orchestrator`: supervise one or more `codex exec` workers for delegated implementation, review, analysis, or generation work. Trigger when the user starts with `/sub`, or asks for subagents, worker teams, delegated execution, parallel Codex runs, supervisory workflows, or multi-agent delivery in this workspace. File: `./skills/codex-subagent-orchestrator/SKILL.md`

### Workspace local skill rules

- If the user starts with `/sub`, you must treat that as a workspace-local subagent orchestration request.
- For `/sub` and other obvious subagent orchestration requests, open and follow `./skills/codex-subagent-orchestrator/SKILL.md`.
- For `/sub`, choose the orchestration shape autonomously from the request context:
  - use the team launcher path for one-off bounded tasks, single tickets, or finite delivery requests
  - use the queue runner path for unattended polling, repeated ticket dispatch, background issue handling, tracker monitoring, or "keep processing work" requests
- Resolve all relative paths from `./skills/codex-subagent-orchestrator/` first.
- Keep the workflow self-contained in this workspace when possible.
- For `/sub` work, the parent should stay in supervisor mode for requested deliverable files.
- For `/sub` work, reviewers and validators should default to `read-only`.

## Project Identity

Toon for Codex is a local AI comic studio. It turns educational topics, paper-style material, and stories into structured learning comics/webtoon/manga-style page outputs.

The app is intended to be friendly to another user's Codex environment:

- Read `README.md` first when setting up the project.
- Treat this repo as a local app, not a hosted SaaS backend.
- Text planning, analysis, and final script writing use the server-side Gemini API (`GEMINI_API_KEY`, default model `gemini-3-pro-preview`).
- Final comic images and character images use Codex/OpenAI OAuth through the local `openai-oauth` proxy.
- Do not invent secrets, account tokens, API keys, or OAuth credentials. Ask the user to run/login or provide local env values when needed.

## Safe Setup Flow For Codex

When a user asks to set up or run this repo on a new machine, prefer this flow:

1. Check the current working directory is this repo.
2. Read `README.md`, `package.json`, and `.env.example`.
3. Run `npm run setup`.
4. Run `npm install` if dependencies are missing.
5. Ask the user to add `GEMINI_API_KEY` to `.env.local` if Gemini is not configured.
6. Ask the user to run `npx @openai/codex login` if Codex OAuth is not available.
7. Run `npm run dev`.
8. Verify the app at the frontend URL printed by Vite (default: `http://localhost:3000`; if `3000` is busy, Vite may choose another localhost port).
9. Verify backend health at `http://127.0.0.1:8787/api/health`.
10. Report the actual frontend URL, backend health result, and any missing configuration.

Do not commit or expose `.env.local`, local generated outputs, user-uploaded papers, exported ZIPs, or `local-project-archive/`.

## Runtime Defaults

- Frontend: `http://localhost:3000`
- Local API: `http://127.0.0.1:8787`
- Health check: `http://127.0.0.1:8787/api/health`
- Codex OAuth proxy: `10531`
- Local archive default: `./local-project-archive/projects.json`

For one-off port changes, prefer command-line overrides over editing config files. Example:

```bash
npm run dev:web -- --host 0.0.0.0 --port 3002
```

Run the API separately when splitting the stack:

```bash
npm run dev:api
```

## Documentation Boundaries

- `README.md` is for public users and first-time setup.
- `AGENTS.md` is for Codex/AI agents working in this repo.
- `.env.example` documents non-secret local configuration.
- License terms are intentionally not finalized yet. Do not add a license file unless the user decides the licensing direction.

## Development Guardrails

- Preserve existing UI/product flow unless the user asks for a redesign.
- Prefer page-level comic generation behavior over reverting to older panel-by-panel composition docs.
- If generation fails, inspect `.env.local`, Codex login state, `/api/health`, and backend logs before changing app code.
- Keep local archive behavior private and machine-local by default.
