
# Toon for Codex

Codex 앱/CLI 로그인 세션을 만화 제작 파이프라인의 생성 파트너로 쓰기 위한 피벗 실험판입니다.

API 키 없이, 로컬 `openai-oauth` 프록시를 통해 Codex OAuth 경로에서 GPT 플래닝과 이미지 생성을 실행합니다.

## ✅ 개발 환경 세팅 (새 맥북/새 PC)

요구사항:
- Node.js `22+` (권장: `nvm use`로 `.nvmrc` 사용)

설치:
```bash
npm run setup
npm install
```

환경변수:
```bash
cp .env.example .env.local
# 최초 1회 Codex 로그인:
npx @openai/codex login
# 생성 경로는 Codex OAuth 전용입니다. 별도 API 키는 사용하지 않습니다.
# (선택) 페이지 수 상한을 늘리려면 VITE_MAX_PAGE_COUNT / LOCAL_API_MAX_PAGE_COUNT를 조정하세요. (기본 12)
# 프로젝트 보관함은 기본적으로 ./local-project-archive/projects.json 로컬 파일에 저장됩니다.
# 저장 위치를 바꾸려면 LOCAL_PROJECT_ARCHIVE_PATH=/absolute/path/projects.json 을 설정하세요.
```

실행:
```bash
npm run dev
```
기본 포트: `http://localhost:3000`

## 🔎 환각 줄이기: User Research Mode

주제가 민감하거나 사실관계가 중요한 경우, 앱의 TOPIC 단계에서 `User Research`를 선택하면:
- 외부 리서치용 프롬프트(JSON 스키마 포함)를 자동 생성
- 사용자가 리서치 결과(JSON/텍스트)를 붙여넣기
- 앱은 붙여넣은 리서치 팩을 우선 근거로 플랜/스크립트를 생성 (sources URL은 References에 표시)

빌드/프리뷰:
```bash
npm run build
npm run preview
```
(`npm run preview`는 로컬 백엔드도 함께 실행합니다.)

주의:
- 기본 플랜/이미지 생성은 Codex OAuth 세션을 사용합니다.
- Gemini/OpenAI API 키 경로는 제거되었습니다.
- 서버는 기본적으로 `openai-oauth` 프록시를 `10531` 포트에서 자동 실행합니다.
- `npm run dev`는 로컬 백엔드 + Vite를 함께 실행합니다.

## 🚀 새로운 파이프라인 (Codex Local Engine)

1.  **Codex Planning**: 주제/캐릭터/스타일을 바탕으로 페이지별 스토리보드와 컷 구성을 생성합니다.
2.  **Prompt Assembly**: 각 페이지를 GPT 이미지 생성에 맞는 긴 제작 프롬프트로 변환합니다.
3.  **Codex Image Generation**: Codex OAuth 세션의 `image_generation` tool로 페이지 이미지를 생성합니다.
4.  **Reader / Export**: 생성된 페이지를 앱 리더에 반영하고 ZIP으로 내보냅니다.

### GPT Image 2 sizing

이미지 생성은 여전히 `OPENAI_API_KEY` 직접 호출이 아니라 Codex OAuth 인증 경로를 사용합니다. 앱의 `1K / 2K / 4K` 선택값은 GPT Image 2의 `size: "WIDTHxHEIGHT"` 제약에 맞춰 16px 배수, 최대 3840px 변, 최대 8,294,400px, 장변:단변 3:1 이하로 변환됩니다.

- `9:16`: `1K=1008x1792`, `2K=1152x2048`, `4K=2160x3840`
- `16:9`: `1K=1792x1008`, `2K=2048x1152`, `4K=3840x2160`
- `1:1`: `1K=1024x1024`, `2K=2048x2048`, `4K=2880x2880`

## 🎨 Layout Variety Level

사용자는 `Layout Variety` 설정을 통해 결과물의 역동성을 조절할 수 있습니다:

-   **Low**: 안정적인 2x2, 수평/수직 띠 형태의 레이아웃 위주. 가독성 최우선.
-   **Medium (Default)**: 히어로 컷(큰 패널)과 작은 패널들이 섞인 변칙 격자 사용.
-   **High**: 대각선 분할 패널(Diagonal), 인셋(Inset) 오버레이 등 과감한 기법 적극 사용.

## 👤 캐릭터 일관성 모드 (Loose / Strict)

`01. Setup Character` 단계에서 `캐릭터 일관성 모드`를 선택할 수 있습니다:
- **Loose(기본)**: 기본 수준의 외모/복장 일관성.
- **Strict(엄격)**: 얼굴/헤어/체형/의상(색·패턴·소품) 변형을 강하게 금지하고, 캐릭터 레퍼런스 이미지를 우선 사용합니다.

## 📁 주요 구성 파일
- `layout_templates.json`: 12가지 레이아웃 템플릿 정의 (poly, rect 좌표 포함).
- `services/composer.ts`: Canvas API를 이용한 패널 합성 로직.
- `services/planner.ts`: 템플릿 선택 및 비율 조정 로직.

## 🛠 CURL 파이프라인 테스트 예시
```bash
# 1. 시나리오 및 레이아웃 플랜 생성
# POST /api/plan { topic: "AI", layout_variety: "high" }

# 2. 패널별 이미지 생성 (4회 반복)
# POST /api/generate-panel { prompt: "Panel 1 scene...", ratio: "16:9" }

# 3. 페이지 합성
# POST /api/compose { page_id: 1, template: "diagonal_split_v1", images: [...] }
```

## 📝 참고 사항
- 패널 생성 시 `negative_prompt`에 프레임/그리드 방지 키워드를 강화하여 AI가 단일 컷 이미지만 생성하도록 유도했습니다.
- 대각선 패널(`poly`)은 Canvas의 `clip()` 기능을 통해 실제 픽셀 단위로 정확하게 잘라내어 합성합니다.
