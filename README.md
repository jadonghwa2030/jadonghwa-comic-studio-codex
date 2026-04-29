# Toon for Codex

Codex-ready local AI comic studio for turning topics, papers, and stories into structured learning comics.

Toon for Codex runs on your own machine and uses your logged-in Codex/OpenAI session through a local `openai-oauth` proxy. It is designed for people who want an AI assistant to help set up and run the app locally without exposing API keys in the repository.

## What This Makes

- Learning comics from a topic, question, or source material
- Paper explainers that turn research content into a readable page-by-page story
- Story/webtoon drafts with character, style, and layout controls
- Page-level comic images generated from a structured production prompt
- ZIP exports and a local project archive for continuing work later

The app is not just a one-shot "prompt to comic" demo. Its core value is the planning layer: it breaks source material into pages, assigns each page a narrative or learning role, builds character/style anchors, and then asks Codex image generation to render complete comic pages.

## Why It Is Different

- **Codex-ready local setup**: designed to be opened by Codex and configured on another user's computer.
- **No direct API key generation path**: main planning and image generation use Codex OAuth, not checked-in API secrets.
- **Learning-first planning**: pages can be planned as definitions, comparisons, processes, reveals, quizzes, misconceptions, experiments, and more.
- **Paper/story inputs**: supports educational topics, prose/story scripts, and paper-style explainer flows.
- **Character and style consistency**: supports recurring cast, reference images, strict/loose identity rules, style references, and previous-page style continuity.
- **Multiple comic formats**: learning comic, webtoon, manga, and image-to-video keyframe style outputs.
- **Local archive**: saved projects are stored in a local machine file by default, not only in browser storage.

## Quick Start

Requirements:

- Node.js `22+`
- A working Codex login on the machine that will run generation

Install and prepare local config:

```bash
npm run setup
npm install
npx @openai/codex login
```

Run the app:

```bash
npm run dev
```

Open the frontend URL printed by Vite.

Usually it is:

```txt
http://localhost:3000
```

If port `3000` is already in use, Vite may move to another localhost port such as `3001`. In that case, use the URL shown in the terminal.

Check backend health:

```txt
http://127.0.0.1:8787/api/health
```

`npm run dev` starts both the local backend and the Vite frontend. The backend defaults to port `8787`; Vite defaults to port `3000`; the Codex OAuth proxy defaults to port `10531`.

## Set This Up With Codex

If you cloned this repository and want Codex to set it up, open the repository in Codex and say:

```txt
이 repo를 로컬에서 실행 가능하게 세팅해줘.
먼저 AGENTS.md와 README.md를 읽고, 앱 코드는 바꾸지 말고 세팅 상태만 확인해줘.
npm run setup, npm install, npx @openai/codex login 필요 여부, npm run dev 순서로 진행해줘.
secret이나 계정 정보는 직접 만들거나 추측하지 말고 나한테 물어봐.
마지막에는 실제 frontend URL과 /api/health 상태를 알려줘.
```

Codex should not invent secrets or commit local generated files. If generation fails, it should first check `.env.local`, the Codex login state, `http://127.0.0.1:8787/api/health`, and the terminal logs from the local backend.

## Configuration

Create local env config:

```bash
cp .env.example .env.local
```

Important `.env.example` values:

- `CODEX_OAUTH_PROXY_PORT=10531`
- `LOCAL_API_PORT=8787`
- `CODEX_TEXT_MODEL=gpt-5.5`
- `CODEX_IMAGE_MODEL=gpt-5.4-mini`
- `VITE_MAX_PAGE_COUNT=12`
- `LOCAL_API_MAX_PAGE_COUNT=12`

The frontend reads the active Codex image model from `/api/health`, so `CODEX_IMAGE_MODEL` also affects normal in-app page generation.

These are local example values copied by `npm run setup` when `.env.local` is missing. Runtime code also has internal fallbacks, so treat `.env.example` as the editable local configuration surface.

Project archive:

- Default path: `./local-project-archive/projects.json`
- Override with `LOCAL_PROJECT_ARCHIVE_PATH=/absolute/path/projects.json`
- Do not commit `local-project-archive/`

## Main Pipeline

1. **Input**: choose educational topic, story input, or paper-style material.
2. **Planning**: Codex builds a page-level story plan, learning intent, cast/style anchors, and panel beats.
3. **Prompt assembly**: each page becomes a detailed production prompt with layout, character, style, text, and safety rules.
4. **Image generation**: the local backend calls Codex image generation through the OAuth proxy.
5. **Review and regenerate**: generated pages stay visible; failed pages can be retried without losing the rest.
6. **Archive/export**: save locally and export a ZIP when needed.

## Useful Commands

```bash
npm run setup       # Create .env.local if missing and print next steps
npm run dev         # Start local API + Vite frontend
npm run dev:api     # Start only local API
npm run dev:web     # Start only Vite frontend
npm run typecheck   # TypeScript check
npm run build       # Production build
npm run preview     # Local API + Vite preview
```

## Troubleshooting

### The app opens but generation does not work

Check:

```bash
npx @openai/codex login
```

Then open:

```txt
http://127.0.0.1:8787/api/health
```

If health is not reachable, the local backend is not running or `LOCAL_API_PORT` is different.

### Port already in use

The common ports are:

- Frontend: `3000`
- Local API: `8787`
- Codex OAuth proxy: `10531`

For a one-off frontend port change:

```bash
npm run dev:web -- --host 0.0.0.0 --port 3002
```

Run the API separately if needed:

```bash
npm run dev:api
```

### Local projects disappeared

The app stores saved project metadata in `local-project-archive/projects.json` by default. Check whether `LOCAL_PROJECT_ARCHIVE_PATH` was changed or whether the folder was deleted. Browser localStorage is only a fallback/legacy path.

## Before Public Release

This repository is being prepared for public release, but a few things should be finalized before making it public:

- Add screenshots or sample output images
- Decide and add `LICENSE` or `LICENSE.md`
- Run a clean clone setup test
- Confirm `.env.local`, local archives, generated exports, and private source files are ignored
- Re-read this README from the perspective of a first-time user

## Security Notes

- Never commit `.env.local`
- Never commit Codex/OpenAI account tokens
- Never commit generated private user materials
- Never commit `local-project-archive/`
- Treat uploaded papers, generated pages, and project archives as local/private user data
