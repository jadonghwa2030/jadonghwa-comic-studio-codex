
import React, { useEffect, useRef, useState } from 'react';
import { GEMINI_PLANNER_MODEL, generatePaperPlan, generatePlan, generateStoryPlan } from './services/planner';
import { translateSeriesPlan } from './services/translationService';
import { generateFullPageImage } from './services/renderer';
import { buildKlingI2VPromptPack } from './services/klingPrompt';
import { getStylePresets, selectStyle } from './services/styleService';
import { analyzeResearchReport } from './services/researchService';
import { analyzeStoryScript } from './services/storyAnalysisService';
import { analyzePaperPdf, analyzePaperUrl } from './services/paperService';
import { generateGeminiResearchPack } from './services/geminiResearchService';
import { getJson } from './services/localApi';
import { DELIVERY_STYLE_PRESETS, resolveDeliveryStyleSpec } from './services/deliveryStyles';
import { downloadAsZip, downloadFilesAsZip } from './services/postprocessor';
import { composeWebtoonEpisodeSegments } from './services/webtoonEpisodeService';
import { buildCodexHandoffFiles } from './services/codexHandoffService';
import { CastPreset, CastPresetPayload, loadCastPresets, persistCastPresets } from './services/castPresetService';
import { analyzeCharacterImage, generateCharacterCandidates, generateStyleAlignedCharacterReference, suggestCastFromContent } from './services/characterService';
import { SavedComicProject, SavedComicProjectSnapshot, loadSavedComicProjects, persistSavedComicProjects } from './services/projectArchiveService';
import { PageScriptEditorModal } from './components/PageScriptEditorModal';
import { PageEditActionModal } from './components/PageEditActionModal';
import { PageStyleEditorModal } from './components/PageStyleEditorModal';
import { PageNarrativePreview } from './components/PageNarrativePreview';
import { DevPromptCheckModal } from './components/DevPromptCheckModal';
import { SeriesPlan, SeriesSpec, PageSpec, AppStatus, GenerationResult, NarrativeRole, StylePreset, LayoutTemplate, LayoutVariety, ImageSize, GroundingSource, ResearchMode, ResearchPack, QuestionType, ComicMode, ToneMode, ToneLevel, ScriptDetail, PageCountMode, AudienceLevel, DeliveryStyleId, IntroStyle, CharacterSpec, CastRole, CatchphraseFrequency, CharacterConsistencyMode, Language, OutputMode, I2VAspectRatio, PublicationFormat, MangaColorMode, CreationType, StoryInputType, AgeRating, StoryGenre, PacingPreference, PaperBrief, GeminiReasoningEffort, WebtoonEpisodeRenderResult, ImageProvider, CodexImageQuality } from './types';
import { getFormatConfig, getTemplatesForFormat, FORMAT_CONFIGS, isKlingI2V as isKlingI2VFormat, isWebtoon, isManga, isLearningComic } from './services/formatConfig';
import { Loader2, BookOpen, Sparkles, Key, User, ArrowRight, Upload, Palette, CheckCircle2, RotateCcw, Plus, Wand2, LayoutGrid, Layers, Monitor, ChevronRight, ChevronLeft, Download, FileText, Settings2, Globe, ExternalLink, Lightbulb, UserCheck, MessageSquareText, Copy, Trash2, Bookmark, FolderOpen, Save, AlertTriangle } from 'lucide-react';

const DEFAULT_MAX_PAGE_COUNT = 12;
const MAX_SAVED_PROJECTS = 20;
const MAX_PERSISTABLE_DATA_URL_LENGTH = 300_000;
const MAX_PERSISTABLE_REF_IMAGES_PER_CHARACTER = 1;
const MAX_PERSISTABLE_PRODUCT_REF_IMAGES = 1;
const REFERENCE_IMAGE_MAX_EDGE = 1024;
const REFERENCE_IMAGE_JPEG_QUALITY = 0.82;

const resolveMaxPageCount = (): number => {
  const raw = String(import.meta.env.VITE_MAX_PAGE_COUNT ?? "").trim();
  if (!raw) return DEFAULT_MAX_PAGE_COUNT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_PAGE_COUNT;
};

const MAX_PAGE_COUNT = resolveMaxPageCount();

const clampPageCount = (value: number): number => {
  const floored = Math.floor(value);
  if (!Number.isFinite(floored)) return 1;
  return Math.max(1, Math.min(MAX_PAGE_COUNT, floored));
};

const isEduCinematicMode = (mode: ComicMode): boolean => mode === "cinematic";
const isPureCinematicMode = (mode: ComicMode): boolean => mode === "pure_cinematic";
const isAnyCinematicMode = (mode: ComicMode): boolean => isEduCinematicMode(mode) || isPureCinematicMode(mode);
const I2V_TEMPLATE_BY_RATIO: Record<I2VAspectRatio, string> = {
  "16:9": "i2v_frame_16_9",
  "9:16": "i2v_frame_9_16",
  "1:1": "i2v_frame_1_1"
};
const IMAGE_SIZE_OPTIONS: ImageSize[] = ["1K", "2K", "4K"];
const DEFAULT_IMAGE_PROVIDER: ImageProvider = "codex";
const DEFAULT_CODEX_IMAGE_QUALITY: CodexImageQuality = "medium";
const DEFAULT_CODEX_IMAGE_MODEL = "gpt-5.5";
const DEFAULT_LAYOUT_VARIETY: LayoutVariety = "high";
type OutputReaderMode = "visual" | "visual_plus_script";
type UiLanguage = "ko" | "en";

const getInitialUiLanguage = (): UiLanguage => {
  try {
    const saved = localStorage.getItem("toon_for_codex_ui_language");
    return saved === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
};

const formatLabel = (
  uiLanguage: UiLanguage,
  labelKo: string | undefined,
  labelEn: string | undefined,
  fallback: string
): string => {
  if (uiLanguage === "ko") return labelKo || fallback;
  return labelEn || fallback;
};

interface HealthResponse {
  codex_oauth_autostart?: boolean;
  codex_oauth_port?: number;
  codex_image_model?: string;
}

const normalizeCodexImageModel = (model?: string): string =>
  String(model || "").trim() || DEFAULT_CODEX_IMAGE_MODEL;

const deriveTopicFromMaterial = (material: string, fallback: string): string => {
  const firstLine = material
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
};

const getCodexImageModelLabel = (model?: string): string => {
  const normalized = normalizeCodexImageModel(model);
  if (normalized === "gpt-5.4-mini") return "Codex GPT 5.4 Mini";
  if (normalized === "gpt-5.4") return "Codex GPT 5.4";
  if (normalized === "gpt-5.5") return "Codex GPT 5.5";
  return normalized;
};

const buildImageEngineKey = (
  provider: ImageProvider,
  codexImageQuality: CodexImageQuality
): string =>
  `codex:${DEFAULT_CODEX_IMAGE_MODEL}:${codexImageQuality}`;

const getImageEngineLabel = (
  provider: ImageProvider,
  codexImageQuality: CodexImageQuality
): string =>
  `${getCodexImageModelLabel()} (${codexImageQuality})`;

const getImageEngineChipLabel = (
  provider: ImageProvider,
  codexImageQuality: CodexImageQuality
): string =>
  `Codex ${codexImageQuality}`;

const getImageEngineChipLabelFromKey = (key: string | null | undefined): string => {
  const normalized = String(key || "").trim();
  if (!normalized) return "";
  if (normalized.startsWith("codex:")) {
    const [, model = DEFAULT_CODEX_IMAGE_MODEL, quality = "medium"] = normalized.split(":");
    return `${getCodexImageModelLabel(model).replace(/^Codex\s+/, "")} ${quality}`;
  }
  return normalized;
};

const getPreviewAspectClass = (format: PublicationFormat, ratio: I2VAspectRatio): string => {
  if (isKlingI2VFormat(format)) {
    if (ratio === "16:9") return "aspect-[16/9]";
    if (ratio === "1:1") return "aspect-[1/1]";
    return "aspect-[9/16]";
  }
  if (isWebtoon(format)) return "aspect-[9/16]";
  if (isManga(format)) return "aspect-[728/1032]";
  return "aspect-[9/16]";
};

const getUnitLabelForFormat = (format: PublicationFormat): string =>
  getFormatConfig(format).unitLabel;

/** Map PublicationFormat back to legacy OutputMode for downstream services */
const toLegacyOutputMode = (format: PublicationFormat): OutputMode =>
  format === "kling_i2v" ? "kling_i2v" : "comic";

const getComicModeDisplayLabel = (mode: ComicMode): string => {
  if (isPureCinematicMode(mode)) return "CINEMATIC";
  if (isEduCinematicMode(mode)) return "SCENE-LED";
  return "LEARNING";
};

const getComicModeEssenceLabel = (mode: ComicMode): string => {
  if (isPureCinematicMode(mode)) return "Cinematic Essence";
  if (isEduCinematicMode(mode)) return "Scene-Led Learning";
  return "Learning Essence";
};

const maskSecretsInText = (value: string): string => {
  return value
    .replace(/sk-[A-Za-z0-9]{8,}/g, "sk-***")
    .replace(/AIza[0-9A-Za-z\-_]{8,}/g, "AIza***")
    .replace(/Bearer\s+[A-Za-z0-9\-_\.]{8,}/gi, "Bearer ***");
};

const toUserFacingError = (rawMessage: string, fallback: string, uiLanguage: UiLanguage = "ko"): string => {
  const masked = maskSecretsInText(String(rawMessage || "").trim() || fallback);
  if (/failed to fetch|networkerror/i.test(masked)) {
    return uiLanguage === "ko"
      ? [
        "로컬 API 서버에 연결하지 못했어. (Failed to fetch)",
        "1) `npm run dev`로 web+api를 함께 실행해줘.",
        "2) 또는 `npm run dev:api`(8787) + `npm run dev:web`(3000)을 각각 실행해줘.",
        "3) `http://127.0.0.1:8787/api/health` 접속 시 JSON이 보이면 정상이야."
      ].join("\n")
      : [
        "Could not connect to the local API server. (Failed to fetch)",
        "1. Run web+api together with `npm run dev`.",
        "2. Or run `npm run dev:api` (8787) and `npm run dev:web` (3000) separately.",
        "3. If `http://127.0.0.1:8787/api/health` returns JSON, the API is healthy."
      ].join("\n");
  }
  return masked;
};

type CastSuggestionNotice = {
  kind: "info" | "success" | "error";
  message: string;
  detail?: string;
};

const deepClone = <T,>(value: T): T => {
  const sc = (globalThis as any)?.structuredClone as ((v: T) => T) | undefined;
  if (typeof sc === "function") return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const createClientId = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = crypto as any;
    if (c?.randomUUID) return c.randomUUID();
  } catch { }
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const createCharacter = (role: CastRole, name?: string): CharacterSpec => {
  const defaultName = role === "protagonist" ? "주인공" : "";
  return {
    id: createClientId(),
    role,
    name: String(name ?? defaultName),
    appearance: "",
    persona: "",
    catchphrase: "",
    catchphrase_frequency: "rare",
    reference_images: []
  };
};

const isDataUrl = (value: unknown): boolean => {
  return typeof value === "string" && /^data:/i.test(value.trim());
};

const keepPersistableImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isDataUrl(trimmed) && trimmed.length > MAX_PERSISTABLE_DATA_URL_LENGTH) return null;
  return trimmed;
};

const pickPersistableImageUrls = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value) || limit <= 0) return [];
  const picked: string[] = [];
  for (const raw of value) {
    const persistable = keepPersistableImageUrl(raw);
    if (!persistable) continue;
    picked.push(persistable);
    if (picked.length >= limit) break;
  }
  return picked;
};

const sortGenerationResults = (items: GenerationResult[]): GenerationResult[] =>
  [...items].sort((a, b) => a.page_index - b.page_index);

const upsertGenerationResult = (
  prev: GenerationResult[],
  nextItem: GenerationResult
): GenerationResult[] =>
  sortGenerationResults([
    ...prev.filter((item) => item.page_index !== nextItem.page_index),
    nextItem,
  ]);

const compactStyleForStorage = (
  style: SeriesSpec["anchors"]["style"] | null | undefined
): SeriesSpec["anchors"]["style"] | null => {
  if (!style) return null;
  return {
    ...style,
    style_reference_image: keepPersistableImageUrl(style.style_reference_image ?? "") || null
  };
};

const compactCastForStorage = (items: CharacterSpec[]): CharacterSpec[] => {
  return items.map((c) => ({
    ...c,
    reference_images: pickPersistableImageUrls(c.reference_images, MAX_PERSISTABLE_REF_IMAGES_PER_CHARACTER),
    style_aligned_reference_images: pickPersistableImageUrls(c.style_aligned_reference_images, 1)
  }));
};

const compactSeriesPlanForStorage = (plan: SeriesPlan): SeriesPlan => {
  const next = deepClone(plan);
  // Planner debug payload can be very large and cause localStorage quota failures.
  if ((next as any).debug) delete (next as any).debug;
  const anchors = next.series_spec?.anchors;
  if (!anchors) return next;

  if (anchors.protagonist?.reference_images) {
    const compactedPack = pickPersistableImageUrls(
      anchors.protagonist.reference_images.pack,
      MAX_PERSISTABLE_REF_IMAGES_PER_CHARACTER
    );
    const compactedMain = keepPersistableImageUrl(anchors.protagonist.reference_images.main);
    anchors.protagonist.reference_images.main = compactedMain || compactedPack[0] || "";
    anchors.protagonist.reference_images.pack = compactedPack;
  }

  if (anchors.product?.reference_images) {
    anchors.product.reference_images = pickPersistableImageUrls(
      anchors.product.reference_images,
      MAX_PERSISTABLE_PRODUCT_REF_IMAGES
    );
  }

  if (Array.isArray(anchors.cast)) {
    anchors.cast = compactCastForStorage(anchors.cast);
  }

  const compactedStyle = compactStyleForStorage(anchors.style);
  if (compactedStyle) {
    anchors.style = compactedStyle;
  }

  return next;
};

const compactStyleOverrideRecordForStorage = (
  overrides: Record<number, SeriesSpec["anchors"]["style"]>
): Record<number, SeriesSpec["anchors"]["style"]> => {
  const next: Record<number, SeriesSpec["anchors"]["style"]> = {};
  for (const [rawIndex, style] of Object.entries(overrides)) {
    const pageIndex = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(pageIndex)) continue;
    const compactedStyle = compactStyleForStorage(style);
    if (!compactedStyle) continue;
    next[pageIndex] = compactedStyle;
  }
  return next;
};

const normalizeCastFromSnapshot = (items: CharacterSpec[] | null | undefined): CharacterSpec[] => {
  const mapped: CharacterSpec[] = (Array.isArray(items) ? items : []).map((c) => {
    const role: CastRole = c?.role === "supporting" ? "supporting" : "protagonist";
    const catchphraseFrequency: CatchphraseFrequency =
      c?.catchphrase_frequency === "often" || c?.catchphrase_frequency === "sometimes"
        ? c.catchphrase_frequency
        : "rare";

    return {
      ...createCharacter(role),
      id: createClientId(),
      role,
      name: String(c?.name ?? ""),
      appearance: String(c?.appearance ?? ""),
      analyzed_appearance: String(c?.analyzed_appearance ?? "").trim() || undefined,
      persona: String(c?.persona ?? ""),
      catchphrase: String(c?.catchphrase ?? ""),
      catchphrase_frequency: catchphraseFrequency,
      reference_images: Array.isArray(c?.reference_images)
        ? c.reference_images
          .map((img) => keepPersistableImageUrl(img))
          .filter((img): img is string => Boolean(img))
        : [],
      style_aligned_reference_images: pickPersistableImageUrls((c as any)?.style_aligned_reference_images, 1),
      style_aligned_reference_style_key: String((c as any)?.style_aligned_reference_style_key ?? "").trim() || undefined
    };
  });

  const protagonists = mapped.filter((c) => c.role === "protagonist").slice(0, 2);
  const supporting = mapped.filter((c) => c.role === "supporting");
  return protagonists.length > 0 ? [...protagonists, ...supporting] : [createCharacter("protagonist"), ...supporting];
};

const syncPlanAnchorsFromSnapshot = (
  plan: SeriesPlan,
  opts: {
    cast: CharacterSpec[];
    productReferenceImages: string[];
    finalStyle: SeriesSpec["anchors"]["style"] | null;
    narrativeRole: NarrativeRole;
    topic: string;
    comicMode: ComicMode;
    publicationFormat: PublicationFormat;
    i2vAspectRatio: I2VAspectRatio;
    mangaColorMode?: MangaColorMode;
    imageProvider: ImageProvider;
    codexImageQuality: CodexImageQuality;
    characterConsistencyMode: CharacterConsistencyMode;
    storyAntiEducationGuardEnabled: boolean;
  }
): SeriesPlan => {
  const next = deepClone(plan);
  const spec = next?.series_spec;
  if (!spec?.anchors?.protagonist) return next;

  const anchors = spec.anchors;
  const cast = (opts.cast || []).map((c) => ({
    ...c,
    reference_images: Array.isArray(c.reference_images) ? [...c.reference_images] : []
  }));

  if (cast.length > 0) anchors.cast = cast;
  else delete anchors.cast;

  const primary = cast.find((c) => c.role === "protagonist");
  if (primary) {
    const refPack = Array.isArray(primary.reference_images) ? primary.reference_images.filter(Boolean) : [];
    const fallbackMain = keepPersistableImageUrl(anchors.protagonist.reference_images?.main) || "";
    const fallbackPack = Array.isArray(anchors.protagonist.reference_images?.pack)
      ? anchors.protagonist.reference_images.pack.filter(Boolean)
      : [];
    const protagonistAppearance =
      String(primary.appearance || "").trim() ||
      String(primary.name || "").trim() ||
      String(anchors.protagonist.appearance || "").trim();
    const mergedPack = refPack.length > 0 ? refPack : fallbackPack;

    anchors.protagonist = {
      ...anchors.protagonist,
      appearance: protagonistAppearance,
      role: opts.narrativeRole,
      reference_images: {
        main: mergedPack[0] || fallbackMain,
        pack: mergedPack
      }
    };
  } else {
    anchors.protagonist = {
      ...anchors.protagonist,
      role: opts.narrativeRole
    };
  }

  if (opts.productReferenceImages.length > 0) {
    const existingLabel = String(anchors.product?.label || "").trim();
    const fallbackLabel =
      String(opts.topic || "").trim() || String(spec.series?.title || "").trim() || "Product";
    anchors.product = {
      label: existingLabel || fallbackLabel,
      reference_images: opts.productReferenceImages
    };
  } else {
    delete anchors.product;
  }

  if (opts.finalStyle) anchors.style = opts.finalStyle;
  spec.constraints = {
    ...spec.constraints,
    comic_mode: opts.comicMode,
    output_mode: toLegacyOutputMode(opts.publicationFormat),
    publication_format: opts.publicationFormat,
    manga_color_mode: opts.mangaColorMode,
    i2v_aspect_ratio: opts.i2vAspectRatio,
    image_provider: opts.imageProvider,
    codex_image_quality: opts.codexImageQuality,
    character_consistency_mode: opts.characterConsistencyMode,
    story_anti_education_guard: opts.storyAntiEducationGuardEnabled
  };
  return next;
};

const buildCastSummaryLine = (c: CharacterSpec): string => {
  const name = String(c.name || "").trim();
  const appearance = String(c.appearance || "").trim();
  const persona = String(c.persona || "").trim();
  const catchphrase = String(c.catchphrase || "").trim();
  const freq = String(c.catchphrase_frequency || "rare").trim();
  const bits = [];
  if (name) bits.push(name);
  if (persona) bits.push(persona);
  if (appearance) bits.push(appearance);
  if (catchphrase) bits.push(`말버릇(${freq}): ${catchphrase}`);
  return bits.join(" / ");
};

const buildStyleReferenceKey = (style: SeriesSpec["anchors"]["style"]): string =>
  [
    "photo-style-transfer-v1",
    style.preset_id,
    style.render_mode,
    style.style_prompt,
    style.user_style_prompt || ""
  ].join("|");

const buildGenreEraLockForCharacter = (sourceText: string): string => {
  if (/(무협|무림|강호|문파|내공|단전|검법|검기|협객|사부|사형|사매|장문인|비급|객잔|도관|도사|마교|정파|사파)/i.test(sourceText)) {
    return "WUXIA / murim martial arts world. Use traditional East Asian martial arts costume: flowing hanfu/hanbok-inspired robes, martial sect uniform, cloth belt, bracers, sword sheath, topknot or long tied hair. Absolutely avoid modern business suits, blazers, neckties, office-worker styling, sneakers, and contemporary city fashion unless the source explicitly says so.";
  }
  if (/(사극|조선|고려|왕궁|궁궐|왕세자|왕비|선비|한복|도포|상투|기생|장군|포졸|관아)/i.test(sourceText)) {
    return "Historical period drama world. Use traditional period clothing such as hanbok, dopo, official robes, armor, or court clothing. Avoid modern suits, neckties, office outfits, and contemporary fashion.";
  }
  if (/(중세|기사|마법사|왕국|공작|후작|백작|검과 마법|드래곤|엘프|마탑|성기사)/i.test(sourceText)) {
    return "Medieval fantasy world. Use tunics, cloaks, robes, leather gear, armor, or fantasy uniforms. Avoid modern suits, neckties, and office outfits.";
  }
  if (/(sf|sci-fi|우주|행성|사이버|로봇|안드로이드|우주선|미래도시)/i.test(sourceText)) {
    return "Science-fiction world. Use future-facing uniforms, functional jackets, tech gear, or space/cyber silhouettes instead of ordinary modern business clothing.";
  }
  return "Follow the era, place, and genre implied by the source material. Do not default to modern business suits or office clothing unless the source clearly requires it.";
};

const buildResearchPrompt = (topic: string, role: NarrativeRole, questionType: QuestionType): string => {
  const looksLikeHowToTopic = (t: string): boolean =>
    /(방법|하는\s*법|만드는\s*법|만들기|레시피|조리법|요리|튜토리얼|가이드|절차|순서|단계|설치|세팅|설정|사용법|how\s*to|tutorial|guide|recipe|setup|install)/i.test(
      String(t || "").trim()
    );

  const isHowTo = looksLikeHowToTopic(topic);

  const roleLine =
    role === 'narrator'
      ? '주인공은 제3자 가이드/관찰자(설명자)입니다. 실제 대상(인물/사물/원리)은 주인공과 분리해서 묘사될 수 있게 정보를 정리하세요.'
      : '주인공이 주제의 핵심 인물/원리/대상이 되어 직접 연기합니다. 장면화가 가능한 행동/상황 중심으로 정보를 정리하세요.';

  const questionLine =
    questionType === "compare"
      ? '질문 형태: Compare (A vs B). 승자/패자 단정이 아니라 비교축 기반의 조건부 결론이 목표입니다.'
      : isHowTo
        ? '질문 형태: Explain (How-to). "방법/절차/레시피/튜토리얼" 주제이므로, 오해 반박형 훅(“~라고 생각했겠지만…”)을 강제하지 말고 바로 따라할 수 있게 구성하세요.'
        : '질문 형태: Explain (Concept / Standard). 첫 문장은 "A란/현재진행형이란/오늘은 A를 배워요"처럼 정의/목표로 바로 시작하세요. 도입에서 "단순히 ~가 아니라", "단순한 ~가 아니라", "그것은 단순한 ~가 아니라, ~다", "많이들 ~라고 생각하지만", "사실은", "오해/착각" 같은 AI식 반박/대조 프레이밍을 쓰지 마세요. 오해 교정은 필요할 때만 중후반에 짧게.';

  const extraRuleLine =
    questionType === "compare"
      ? '(Compare) A와 B를 명확히 분리해 question.a / question.b에 넣으세요. (주제가 "A vs B" 형태면 그대로 분해)'
      : "(Explain) 질문을 safe_framing으로 다시 쓰되, 반드시 '정의/경계(무엇이 아닌지)'까지 포함하세요.";

  const outputShape =
    questionType === "compare"
      ? `{
  "question": { "type": "compare", "a": "A", "b": "B" },
  "mini_brief": {
    "safe_framing": "과장/선동 없이 다시 쓴 질문(비교 프레임)",
    "one_line_takeaway": "독자가 가져갈 한 줄(조건부)",
    "comparison_axes": ["비교축1", "비교축2", "비교축3"],
    "verified_claims": [
      { "claim": "핵심 사실/관찰(검증됨)", "evidence": "짧은 근거(링크 없이도 OK)" }
    ],
    "definitions": [
      { "term": "용어/경계", "definition": "짧은 정의" }
    ],
    "where_a_wins": ["조건 ..."],
    "where_b_wins": ["조건 ..."],
    "unknowns": ["UNKNOWN ..."],
    "do_not_say": ["근거 없이 단정 금지 문장/표현"],
    "beats_4_panel": ["1컷(프레임)", "2컷(축1/2)", "3컷(축3/트레이드오프)", "4컷(조건부 결론/주의)"]
  }
}`
      : `{
  "question": { "type": "explain", "topic": "주제" },
  "mini_brief": {
    "safe_framing": "과장/선동 없이 다시 쓴 질문(정의/경계 포함)",
    "one_line_takeaway": "독자가 가져갈 한 줄",
    "verified_claims": [
      { "claim": "핵심 사실/관찰(검증됨)", "evidence": "짧은 근거(링크 없이도 OK)" }
    ],
    "definitions": [
      { "term": "용어/경계", "definition": "짧은 정의" }
    ],
    "common_misconceptions": [
      { "myth": "오해(선택)", "fact": "정정(선택)" }
    ],
    "analogy_bank": [
      { "analogy": "강력한 비유", "maps_to": "어떤 개념을 설명하는지" }
    ],
    "unknowns": ["UNKNOWN ..."],
    "do_not_say": ["근거 없이 단정 금지 문장/표현"],
    "beats_4_panel": ${isHowTo
        ? '["1컷(오늘의 목표/완성)", "2컷(준비물/전제)", "3컷(핵심 단계/순서)", "4컷(주의/팁/체크)"]'
        : '["1컷(상황/질문 훅)", "2컷(정의/경계)", "3컷(원리/예시)", "4컷(요약/체크)"]'
      }
  }
}`;

  return `정보조사 AI에게 다음을 요청하십시오.

주제: "${topic || '[여기에 주제를 넣으세요]'}"
목표: 이 앱(교육 만화)이 환각 없이 스크립트를 만들 수 있도록, 근거가 있는 사실/맥락/비유 재료를 수집해 주세요.
${questionLine}

중요:
- 모르는 내용은 추측하지 말고 "UNKNOWN"으로 표시하세요.
- 단정적 사실/수치는 반드시 "근거(evidence)"를 함께 적어 주세요. (출처 URL은 선택)
- 숫자/연도/고유명사/인과관계는 특히 엄격하게 검증하세요.
- ${extraRuleLine}
- 한국어로 작성하세요.
- ${roleLine}

출력 형식(반드시 JSON만):
${outputShape}`;
};

const buildReportRequestTemplate = (
  topic: string,
  role: NarrativeRole,
  questionType: QuestionType,
  comicMode: ComicMode
): string => {
  const isEduCinematic = comicMode === "cinematic";
  const isPureCinematic = comicMode === "pure_cinematic";

  const roleLine =
    role === "narrator"
      ? isPureCinematic
        ? "주인공은 제3자 관찰자/반응자로 등장합니다. 설명자가 아니라 사건의 리듬을 조절하는 시점으로 재료를 정리해 주세요."
        : isEduCinematic
          ? "주인공은 제3자 가이드/관찰자로 등장합니다. 과도한 강의문 대신 장면에서 의미가 드러나게 정리해 주세요."
          : "주인공은 제3자 가이드/관찰자(설명자)로 등장합니다. 실제 대상(인물/사물/원리)은 주인공과 분리해서 설명되도록, 장면화 가능한 설명 재료로 정리해 주세요."
      : isPureCinematic
        ? "주인공이 사건의 중심 배우가 됩니다. 욕망-갈등-선택-대가가 보이는 사건/행동 중심으로 정리해 주세요."
        : "주인공이 주제의 핵심 인물/원리/대상이 되어 직접 연기합니다. 장면화 가능한 사건/행동/상황 중심으로 정리해 주세요.";

  if (isPureCinematic) {
    const commonRules = `당신은 '시네마틱 스토리 제작'을 위한 리서치 보고서를 작성합니다.

모드: CINEMATIC (순수 스토리)
주제: "${topic || "UNKNOWN"}"
목표: 아래 보고서만을 근거로, 4컷 시네마틱 스토리의 장면 재료(세계관/갈등/전환/엔딩 훅)를 만들 수 있게 합니다.

매우 중요한 규칙(반드시 준수):
- 출력은 한국어, 자연스러운 보고서 문장으로 작성하세요.
- 표(테이블) 사용 금지. (마크다운 표 포함)
- 입력/근거 없이 사실/수치/연도/고유명사/인과관계를 만들어내지 마세요.
- 확인 불가 항목은 반드시 "UNKNOWN"으로 표시하세요. (없는 내용을 채우지 말 것)
- 특정 개인/집단 비방, 허위 사실 단정, 명예훼손성 서사는 금지합니다.
- "교육적 요약/정의 강의" 대신 장면화 가능한 재료(행동, 충돌, 동기, 소품, 공간, 카메라 무드)로 정리하세요.

${roleLine}

권장 분량: 1,500~5,000자(더 길어도 OK).`;

    if (questionType === "review") {
      return `${commonRules}

[보고서 구성(Cinematic Review)]
1) 로그라인(1~2문장)
- 주인공이 무엇을 얻으려다 어떤 문제를 만나는지.

2) 세팅/맥락
- 시간/장소/인물 관계/초기 목표를 명확히.

3) 테스트/충돌 포인트(3~7개)
- 장면에서 바로 보여줄 수 있는 문제/제약/장애물 중심.

4) 전환(해법/선택/트릭)
- 어떤 선택으로 흐름이 바뀌는지, 대가가 무엇인지.

5) 엔딩 훅
- 결론 요약문이 아니라 여운/다음 갈등 암시로 마무리.

6) 비주얼 모티프
- 반복 소품/색감/질감/공간 톤(실사/애니/만화 연출 힌트).

7) 4컷 비트
- 1컷 세팅 → 2컷 충돌 → 3컷 전환 → 4컷 엔딩 훅.

8) UNKNOWN
- 단정할 수 없는 항목을 "UNKNOWN: ..." 형태로 명시

9) Sources
- [S1] ...
- [S2] ...
`;
    }

    if (questionType === "compare") {
      return `${commonRules}

[보고서 구성(Cinematic Compare: 라이벌전)]
1) 로그라인(1~2문장)
- A와 B의 충돌 이유와 결판 조건.

2) 라이벌 프로필
- A의 강점/약점, B의 강점/약점을 장면화 가능한 요소로 정리.

3) 갈등축(3~6개)
- 축마다 어떤 장면 충돌이 가능한지(행동/전술/환경)까지 명시.

4) 반전 포인트
- 우위가 뒤집히는 조건/단서/트리거.

5) 엔딩 설계
- 승패 또는 열린 결말의 조건(비방/허위 단정 금지).

6) 비주얼 모티프
- 각 진영의 상징 요소/톤/카메라 무드.

7) 4컷 비트
- 1컷 대치 → 2컷 압박 → 3컷 반전 → 4컷 결판/훅.

8) UNKNOWN
- 단정할 수 없는 항목을 "UNKNOWN: ..." 형태로 명시

9) Sources
- [S1] ...
- [S2] ...
`;
    }

    return `${commonRules}

[보고서 구성(Cinematic Story: Explain)]
1) 로그라인(1~2문장)
- 주인공의 욕망/결핍과 첫 사건.

2) 세계관/배경 규칙
- 공간, 시대감, 제약 조건, 사건이 성립하는 전제.

3) 인물 동기/감정선
- 주인공(필수)과 대립 요소(인물/환경/상황)의 목표 충돌.

4) 핵심 갈등과 상승 구조
- 긴장이 단계적으로 올라가는 2~4개의 포인트.

5) 전환점과 대가
- 선택 이후 무엇을 얻고 무엇을 잃는지.

6) 엔딩 훅
- 교훈문 대신 여운/질문/다음 갈등 제시.

7) 비주얼 모티프
- 그림체/실사 감각 전환에 도움 되는 소품/색/질감/카메라 톤.

8) 4컷 비트
- 1컷 세팅(욕망) → 2컷 충돌 → 3컷 전환(선택/대가) → 4컷 엔딩 훅.

9) UNKNOWN
- 단정할 수 없는 항목을 "UNKNOWN: ..." 형태로 명시

10) Sources
- [S1] ...
- [S2] ...
`;
  }

  const productionLabel = isEduCinematic ? "Edu-Cinematic 만화 제작" : "교육 만화 제작";
  const goalLabel = isEduCinematic
    ? "교육 핵심은 유지하되 장면 중심으로 전개되는 4컷 스크립트를 안전하게 만들 수 있게 합니다."
    : "교육 만화(페이지 단위, 1페이지=4컷) 스크립트를 안전하게 만들 수 있게 합니다.";
  const commonRules = `당신은 '${productionLabel}'을 위한 리서치 보고서를 작성합니다.

모드: ${isEduCinematic ? "EDU-CINEMATIC" : "LEARNING"}
주제: "${topic || "UNKNOWN"}"
목표: 아래 보고서만을 근거로, ${goalLabel}

매우 중요한 규칙(반드시 준수):
- 출력은 한국어, '한 편의 보고서'처럼 자연스럽게 작성하세요.
- 표(테이블) 사용 금지. (마크다운 표 포함)
- 입력/근거 없이 사실/수치/연도/고유명사/인과관계를 만들어내지 마세요.
- 사실/수치/연도/고유명사는 가능한 한 근거를 함께 붙이세요.
- 근거 형식(예시): [S1] 출처명 (URL) "짧은 인용(1~2문장)" 또는 요약.
- 불확실/논쟁/근거 부족은 반드시 "UNKNOWN"으로 표시하세요. (없는 내용을 채우지 말 것)
- ${isEduCinematic ? "강의문 과다 금지: 장면에서 보여줄 수 있는 재료(행동/상황/소품)를 포함하세요." : "학습 난이도에 맞게 설명 가능하도록 정의/경계를 명확히 써주세요."}

${roleLine}

권장 분량: 1,500~5,000자(더 길어도 OK).`;

  if (questionType === "review") {
    return `${commonRules}

[보고서 구성(Review: 상품/물건)]
1) 한 줄 결론(조건부)
- "무조건 최고/최악" 단정 금지. "X가 중요하면 추천, Y가 중요하면 비추천"처럼 조건부로.

2) 리뷰 대상(제품/버전/가격대/출시 시기/카테고리)
- 모델명/버전/세부 스펙을 확인할 수 없다면 "UNKNOWN" 처리.

3) 사용 시나리오(전제)
- 어떤 사용자/환경/예산/우선순위에서 평가하는지 먼저 선언.

4) 평가 기준(3~7개)
- 각 기준의 의미를 한 문장으로 정의.

5) 장점/단점/리스크(근거 포함)
- 기준별로 균형 있게 작성. 근거 약하면 단정 금지.

6) 만화화 힌트(4컷)
- ${isEduCinematic ? "도입(상황) → 긴장(문제) → 전환(해결) → 결론(조건부 추천)" : "도입(목표) → 핵심기준 → 비교/검증 → 결론/체크"}

7) UNKNOWN
- 지금 보고서 기준으로 단정할 수 없는 항목을 "UNKNOWN: ..." 형태로 명시

8) Sources
- [S1] ...
- [S2] ...
`;
  }

  if (questionType === "compare") {
    return `${commonRules}

[보고서 구성(Compare: A vs B)]
1) 한 줄 결론(조건부)
- "무조건 A가 낫다" 같은 단정 금지.

2) 비교 대상 정의 및 범위
- A/B 정의와 경계(무엇이 아닌지) 포함.

3) 비교축(3~6개)
- 각 비교축의 의미를 한 문장으로 정의.

4) 축별 비교(근거 포함)
- A/B 장점/약점을 균형 있게.

5) 만화화 힌트(4컷)
- ${isEduCinematic ? "도입(대치) → 긴장(충돌) → 전환(트레이드오프) → 결론(조건부)" : "도입(질문) → 축1/2 → 축3/트레이드오프 → 조건부 결론"}

6) UNKNOWN
- 지금 보고서 기준으로 단정할 수 없는 항목을 "UNKNOWN: ..." 형태로 명시

7) Sources
- [S1] ...
- [S2] ...
`;
  }

  return `${commonRules}

[보고서 구성(Explain: A)]
1) 한 줄 결론(요약)

2) 안전한 프레이밍(범위/경계)
- "정확히 무엇을 설명하는지" + "무엇이 아닌지(경계)" 포함

3) 핵심 정의/용어
- 핵심 용어 3~8개를 명료하게 정의 (필요 시 근거)

4) 핵심 원리/절차
- 원리의 단계나 순서를 독자가 따라갈 수 있게 구성

5) 대표 예시/비유(장면화 가능)
- 비유 2~4개 + 무엇을 대응시키는지

6) 만화화 힌트(4컷)
- ${isEduCinematic ? "도입(상황/목표) → 정의/경계 → 사건/행동으로 원리 제시 → 여운/체크" : "도입(질문/목표) → 정의/경계 → 원리/예시 → 요약/체크"}

7) UNKNOWN
- 지금 보고서 기준으로 단정할 수 없는 항목을 "UNKNOWN: ..." 형태로 명시

8) Sources
- [S1] ...
- [S2] ...
`;
};

const parseResearchPack = (input: string): { pack: ResearchPack; error?: string } => {
  const trimmed = input.trim();
  if (!trimmed) return { pack: { notes: "" } };

  const extractFirstUrl = (text: string): string | null => {
    const match = text.match(/https?:\/\/[^\s)>\]"]+/);
    if (!match) return null;
    return match[0].replace(/[),.;\]]+$/, "");
  };

  const normalizeUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const str = value.trim();
    if (!str) return null;
    const url = extractFirstUrl(str);
    return url || str;
  };

  const parseSources = (value: unknown): GroundingSource[] => {
    if (!Array.isArray(value)) return [];
    const out: GroundingSource[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const uri = (rec.uri ?? rec.url ?? rec.href ?? rec.link) as unknown;
      const title = (rec.title ?? rec.name ?? rec.label) as unknown;
      const normalized = normalizeUrl(uri);
      if (normalized && normalized.startsWith("http")) {
        out.push({ title: typeof title === 'string' && title.trim() ? title.trim() : '참고 자료', uri: normalized });
      }
    }
    return out;
  };

  const stringifyIfPresent = (value: unknown): string | null => {
    if (typeof value === "string") return value.trim() ? value.trim() : null;
    if (typeof value === "number") return String(value);
    return null;
  };

  const formatMiniBriefNotes = (data: any): string => {
    const lines: string[] = [];

    const question = data?.question;
    const mini = data?.mini_brief;
    const hasV2 = Boolean(mini && typeof mini === "object");

    if (question && typeof question === "object") {
      const type = stringifyIfPresent(question.type) || "";
      const topic = stringifyIfPresent(question.topic);
      const a = stringifyIfPresent(question.a);
      const b = stringifyIfPresent(question.b);
      const title = type === "compare" ? "비교(Compare)" : type === "explain" ? "설명(Explain)" : type || "UNKNOWN";

      lines.push("[QUESTION]");
      lines.push(`- type: ${title}`);
      if (topic) lines.push(`- topic: ${topic}`);
      if (a) lines.push(`- A: ${a}`);
      if (b) lines.push(`- B: ${b}`);
      lines.push("");
    }

    if (hasV2) {
      const safeFraming = stringifyIfPresent(mini.safe_framing);
      const oneLine = stringifyIfPresent(mini.one_line_takeaway);
      if (safeFraming || oneLine) {
        lines.push("[FRAMING / TAKEAWAY]");
        if (safeFraming) lines.push(`- safe_framing: ${safeFraming}`);
        if (oneLine) lines.push(`- one_line_takeaway: ${oneLine}`);
        lines.push("");
      }

      const axes = Array.isArray(mini.comparison_axes) ? mini.comparison_axes : [];
      if (axes.length > 0) {
        lines.push("[COMPARISON AXES]");
        for (const ax of axes) {
          const s = stringifyIfPresent(ax);
          if (s) lines.push(`- ${s}`);
        }
        lines.push("");
      }

      const fairnessRules = Array.isArray(mini.fairness_rules) ? mini.fairness_rules : [];
      if (fairnessRules.length > 0) {
        lines.push("[FAIRNESS RULES]");
        for (const r of fairnessRules) {
          const s = stringifyIfPresent(r);
          if (s) lines.push(`- ${s}`);
        }
        lines.push("");
      }

      const whereAWins = Array.isArray(mini.where_a_wins) ? mini.where_a_wins : [];
      if (whereAWins.length > 0) {
        lines.push("[WHERE A WINS]");
        for (const w of whereAWins) {
          const s = stringifyIfPresent(w);
          if (s) lines.push(`- ${s}`);
        }
        lines.push("");
      }

      const whereBWins = Array.isArray(mini.where_b_wins) ? mini.where_b_wins : [];
      if (whereBWins.length > 0) {
        lines.push("[WHERE B WINS]");
        for (const w of whereBWins) {
          const s = stringifyIfPresent(w);
          if (s) lines.push(`- ${s}`);
        }
        lines.push("");
      }

      const claims = Array.isArray(mini.verified_claims) ? mini.verified_claims : [];
      if (claims.length > 0) {
        lines.push("[VERIFIED CLAIMS]");
        for (const [idx, c] of claims.entries()) {
          if (!c || typeof c !== "object") continue;
          const claim = stringifyIfPresent(c.claim);
          const evidence = stringifyIfPresent(c.evidence ?? c.quote ?? c.why);
          const sourceUrl = normalizeUrl(c.source_url ?? c.source ?? c.url ?? c.uri);
          if (!claim) continue;
          lines.push(`${idx + 1}) ${claim}`);
          if (evidence) lines.push(`   - evidence: ${evidence}`);
          if (sourceUrl) lines.push(`   - source: ${sourceUrl}`);
        }
        lines.push("");
      }

      const defs = Array.isArray(mini.definitions) ? mini.definitions : [];
      if (defs.length > 0) {
        lines.push("[DEFINITIONS]");
        for (const d of defs) {
          if (!d || typeof d !== "object") continue;
          const term = stringifyIfPresent(d.term);
          const def = stringifyIfPresent(d.definition);
          const sourceUrl = normalizeUrl(d.source_url ?? d.source ?? d.url ?? d.uri);
          if (!term && !def) continue;
          lines.push(`- ${term || "TERM"}: ${def || "DEFINITION"}${sourceUrl ? ` (${sourceUrl})` : ""}`);
        }
        lines.push("");
      }

      const misconceptions = Array.isArray(mini.common_misconceptions) ? mini.common_misconceptions : [];
      if (misconceptions.length > 0) {
        lines.push("[COMMON MISCONCEPTIONS]");
        for (const m of misconceptions) {
          if (!m || typeof m !== "object") continue;
          const myth = stringifyIfPresent(m.myth);
          const fact = stringifyIfPresent(m.fact);
          const sourceUrl = normalizeUrl(m.source_url ?? m.source ?? m.url ?? m.uri);
          if (!myth && !fact) continue;
          lines.push(`- myth: ${myth || "UNKNOWN"}`);
          lines.push(`  fact: ${fact || "UNKNOWN"}${sourceUrl ? ` (${sourceUrl})` : ""}`);
        }
        lines.push("");
      }

      const analogies = Array.isArray(mini.analogy_bank) ? mini.analogy_bank : [];
      if (analogies.length > 0) {
        lines.push("[ANALOGY BANK]");
        for (const a of analogies) {
          if (!a || typeof a !== "object") continue;
          const analogy = stringifyIfPresent(a.analogy);
          const mapsTo = stringifyIfPresent(a.maps_to);
          if (!analogy) continue;
          lines.push(`- ${analogy}${mapsTo ? ` (maps_to: ${mapsTo})` : ""}`);
        }
        lines.push("");
      }

      const beats = Array.isArray(mini.beats_4_panel) ? mini.beats_4_panel : [];
      if (beats.length > 0) {
        lines.push("[BEATS (4-PANEL)]");
        for (const [idx, b] of beats.entries()) {
          const s = stringifyIfPresent(b);
          if (s) lines.push(`${idx + 1}) ${s}`);
        }
        lines.push("");
      }

      const unknowns = Array.isArray(mini.unknowns) ? mini.unknowns : [];
      if (unknowns.length > 0) {
        lines.push("[UNKNOWN / OPEN QUESTIONS]");
        for (const u of unknowns) {
          const s = stringifyIfPresent(u);
          if (s) lines.push(`- ${s}`);
        }
        lines.push("");
      }

      const dns = Array.isArray(mini.do_not_say) ? mini.do_not_say : [];
      if (dns.length > 0) {
        lines.push("[DO NOT SAY]");
        for (const d of dns) {
          const s = stringifyIfPresent(d);
          if (s) lines.push(`- ${s}`);
        }
        lines.push("");
      }

      return lines.join("\n").trim();
    }

    // Legacy format support (notes + key_facts + timeline + ...)
    const summary = stringifyIfPresent(data?.notes ?? data?.summary);
    if (summary) {
      lines.push("[SUMMARY]");
      lines.push(summary);
      lines.push("");
    }

    const keyFacts = Array.isArray(data?.key_facts) ? data.key_facts : [];
    if (keyFacts.length > 0) {
      lines.push("[VERIFIED CLAIMS]");
      for (const [idx, f] of keyFacts.entries()) {
        if (!f || typeof f !== "object") continue;
        const claim = stringifyIfPresent(f.claim);
        const why = stringifyIfPresent(f.why);
        const quote = stringifyIfPresent(f.quote);
        const sourceUrl = normalizeUrl(f.source_url ?? f.source ?? f.url ?? f.uri);
        if (!claim) continue;
        lines.push(`${idx + 1}) ${claim}`);
        if (why) lines.push(`   - why: ${why}`);
        if (quote) lines.push(`   - quote: ${quote}`);
        if (sourceUrl) lines.push(`   - source: ${sourceUrl}`);
      }
      lines.push("");
    }

    const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
    if (timeline.length > 0) {
      lines.push("[TIMELINE]");
      for (const t of timeline) {
        if (!t || typeof t !== "object") continue;
        const date = stringifyIfPresent(t.date);
        const event = stringifyIfPresent(t.event);
        const sourceUrl = normalizeUrl(t.source_url ?? t.source ?? t.url ?? t.uri);
        if (!date && !event) continue;
        lines.push(`- ${date || "DATE"}: ${event || "EVENT"}${sourceUrl ? ` (${sourceUrl})` : ""}`);
      }
      lines.push("");
    }

    const misconceptions = Array.isArray(data?.common_misconceptions) ? data.common_misconceptions : [];
    if (misconceptions.length > 0) {
      lines.push("[COMMON MISCONCEPTIONS]");
      for (const m of misconceptions) {
        if (!m || typeof m !== "object") continue;
        const myth = stringifyIfPresent(m.myth);
        const fact = stringifyIfPresent(m.fact);
        const sourceUrl = normalizeUrl(m.source_url ?? m.source ?? m.url ?? m.uri);
        if (!myth && !fact) continue;
        lines.push(`- myth: ${myth || "UNKNOWN"}`);
        lines.push(`  fact: ${fact || "UNKNOWN"}${sourceUrl ? ` (${sourceUrl})` : ""}`);
      }
      lines.push("");
    }

    const glossary = Array.isArray(data?.glossary) ? data.glossary : [];
    if (glossary.length > 0) {
      lines.push("[GLOSSARY]");
      for (const g of glossary) {
        if (!g || typeof g !== "object") continue;
        const term = stringifyIfPresent(g.term);
        const def = stringifyIfPresent(g.definition);
        const sourceUrl = normalizeUrl(g.source_url ?? g.source ?? g.url ?? g.uri);
        if (!term && !def) continue;
        lines.push(`- ${term || "TERM"}: ${def || "DEFINITION"}${sourceUrl ? ` (${sourceUrl})` : ""}`);
      }
      lines.push("");
    }

    const analogies = Array.isArray(data?.analogy_bank) ? data.analogy_bank : [];
    if (analogies.length > 0) {
      lines.push("[ANALOGY BANK]");
      for (const a of analogies) {
        if (!a || typeof a !== "object") continue;
        const analogy = stringifyIfPresent(a.analogy);
        const mapsTo = stringifyIfPresent(a.maps_to);
        if (!analogy) continue;
        lines.push(`- ${analogy}${mapsTo ? ` (maps_to: ${mapsTo})` : ""}`);
      }
      lines.push("");
    }

    return lines.join("\n").trim() || trimmed;
  };

  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const data = JSON.parse(trimmed) as any;
      if (Array.isArray(data)) {
        return { pack: { notes: JSON.stringify(data, null, 2) } };
      }
      const notes = formatMiniBriefNotes(data) || trimmed;
      const sources = parseSources(data.sources ?? data.references ?? data.citations);
      return { pack: { notes, sources } };
    }
  } catch (e: any) {
    return { pack: { notes: trimmed }, error: e?.message || 'Invalid JSON' };
  }

  return { pack: { notes: trimmed } };
};

const STORY_PUBLICATION_FORMATS: PublicationFormat[] = ["learning_comic", "webtoon", "kling_i2v"];
const PAPER_PUBLICATION_FORMATS: PublicationFormat[] = ["learning_comic", "webtoon"];

const getSelectablePublicationFormats = (creationType: CreationType): PublicationFormat[] =>
  creationType === "paper" ? PAPER_PUBLICATION_FORMATS : STORY_PUBLICATION_FORMATS;

const normalizeSelectablePublicationFormat = (
  format: PublicationFormat,
  creationType: CreationType
): PublicationFormat => {
  if (format === "manga") return "learning_comic";
  if (creationType === "paper" && format === "kling_i2v") return "webtoon";
  return format;
};

const getDefaultNarrativeRole = (creationType: CreationType): NarrativeRole =>
  creationType === "story" ? "actor" : "narrator";

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(getInitialUiLanguage);
  const [topic, setTopic] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [geminiReasoningEffort, setGeminiReasoningEffort] = useState<GeminiReasoningEffort>("medium");
  const [questionType, setQuestionType] = useState<QuestionType>("explain");
  const [creationType, setCreationType] = useState<CreationType>("educational");
  const [scriptText, setScriptText] = useState("");
  const [storyInputType, setStoryInputType] = useState<StoryInputType>("scenario");
  const [ageRating, setAgeRating] = useState<AgeRating>("teen");
  const [storyGenre, setStoryGenre] = useState<StoryGenre | null>(null);
  const [pacingPreference, setPacingPreference] = useState<PacingPreference>("balanced");
  const [storyAntiEducationGuardEnabled, setStoryAntiEducationGuardEnabled] = useState<boolean>(true);
  const [storyDigestText, setStoryDigestText] = useState("");
  const [storyDigestWarnings, setStoryDigestWarnings] = useState<string[]>([]);
  const [storyDigestError, setStoryDigestError] = useState<string | null>(null);
  const [storyPageSuggestions, setStoryPageSuggestions] = useState<Record<ScriptDetail, number> | null>(null);
  const [isStoryAnalyzing, setIsStoryAnalyzing] = useState(false);
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [paperUrl, setPaperUrl] = useState("");
  const [paperBrief, setPaperBrief] = useState<PaperBrief | null>(null);
  const [paperBriefError, setPaperBriefError] = useState<string | null>(null);
  const [isPaperAnalyzing, setIsPaperAnalyzing] = useState(false);
  const [comicMode, setComicMode] = useState<ComicMode>("learning");
  const [publicationFormat, setPublicationFormat] = useState<PublicationFormat>("learning_comic");
  const [mangaColorMode, setMangaColorMode] = useState<MangaColorMode>("bw");
  const [i2vAspectRatio, setI2VAspectRatio] = useState<I2VAspectRatio>("16:9");
  const [toneMode, setToneMode] = useState<ToneMode>("normal");
  const [toneLevel, setToneLevel] = useState<ToneLevel>("medium");
  const [introStyle, setIntroStyle] = useState<IntroStyle>("standard");
  const [language, setLanguage] = useState<Language>("ko");
  const [busyPhase, setBusyPhase] = useState<"planning" | "translating">("planning");
  const [audienceLevel, setAudienceLevel] = useState<AudienceLevel>("beginner");
  const [deliveryStyleId, setDeliveryStyleId] = useState<DeliveryStyleId>("standard");
  const [deliveryCustomInstruction, setDeliveryCustomInstruction] = useState<string>("");
  const [layoutVariety, setLayoutVariety] = useState<LayoutVariety>(DEFAULT_LAYOUT_VARIETY);
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [imageProvider, setImageProvider] = useState<ImageProvider>(DEFAULT_IMAGE_PROVIDER);
  const [codexImageQuality, setCodexImageQuality] = useState<CodexImageQuality>(DEFAULT_CODEX_IMAGE_QUALITY);
  const [scriptDetail, setScriptDetail] = useState<ScriptDetail>("normal");
  const [pageCountMode, setPageCountMode] = useState<PageCountMode>("auto");
  const [targetPageCount, setTargetPageCount] = useState<number>(2);
  const [narrativeRole, setNarrativeRole] = useState<NarrativeRole>("narrator");
  const [characterConsistencyMode, setCharacterConsistencyMode] = useState<CharacterConsistencyMode>("loose");
  const [useCrossPageStyleConsistency, setUseCrossPageStyleConsistency] = useState<boolean>(true);
  const [researchMode, setResearchMode] = useState<ResearchMode>("auto_digest");
  const [researchReportText, setResearchReportText] = useState("");
  const [researchReportFile, setResearchReportFile] = useState<File | null>(null);
  const [isManualMaterialOpen, setIsManualMaterialOpen] = useState(false);
  const [researchDigestText, setResearchDigestText] = useState("");
  const [researchDigestSources, setResearchDigestSources] = useState<GroundingSource[]>([]);
  const [researchDigestWarnings, setResearchDigestWarnings] = useState<string[]>([]);
  const [researchDigestError, setResearchDigestError] = useState<string | null>(null);
  const [pageSuggestions, setPageSuggestions] = useState<Record<ScriptDetail, number> | null>(null);
  const [isResearchAnalyzing, setIsResearchAnalyzing] = useState(false);

  // Resources
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);

  // Cast
  const [characterInputMode, setCharacterInputMode] = useState<"suggest" | "manual">("suggest");
  const [cast, setCast] = useState<CharacterSpec[]>(() => [createCharacter("protagonist")]);
  const [isSuggestingCastFromContent, setIsSuggestingCastFromContent] = useState(false);
  const [castSuggestionNotice, setCastSuggestionNotice] = useState<CastSuggestionNotice | null>(null);
  const [generatingCharacterImageIds, setGeneratingCharacterImageIds] = useState<Record<string, boolean>>({});
  const [stylingCharacterImageIds, setStylingCharacterImageIds] = useState<Record<string, boolean>>({});
  const [characterReferenceErrors, setCharacterReferenceErrors] = useState<Record<string, string>>({});
  const [productReferenceImages, setProductReferenceImages] = useState<string[]>([]);
  const [castPresets, setCastPresets] = useState<CastPreset[]>(() => loadCastPresets());
  const [selectedCastPresetId, setSelectedCastPresetId] = useState<string>("");
  const [savedProjects, setSavedProjects] = useState<SavedComicProject[]>(() => loadSavedComicProjects());
  const [selectedSavedProjectId, setSelectedSavedProjectId] = useState<string>("");
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("kwebtoon_clean_pastel");
  const [selectedStyleCategory, setSelectedStyleCategory] = useState<string>("Webtoon");
  const [finalStyle, setFinalStyle] = useState<SeriesSpec['anchors']['style'] | null>(null);
  const [styleReferenceImage, setStyleReferenceImage] = useState<string | null>(null);
  const [styleReferenceError, setStyleReferenceError] = useState<string | null>(null);

  // Planner
  const [seriesPlan, setSeriesPlan] = useState<SeriesPlan | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [devPromptCheckOpen, setDevPromptCheckOpen] = useState(false);

  // Generation Results
  const [pageResults, setPageResults] = useState<GenerationResult[]>([]);
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [webtoonEpisodeResult, setWebtoonEpisodeResult] = useState<WebtoonEpisodeRenderResult | null>(null);
  const [isBuildingWebtoonEpisode, setIsBuildingWebtoonEpisode] = useState(false);
  const [isExportingCodexHandoff, setIsExportingCodexHandoff] = useState(false);
  const [outputReaderMode, setOutputReaderMode] = useState<OutputReaderMode>("visual");
  const [isProcessingPageIndex, setIsProcessingPageIndex] = useState<number | null>(null);
  const [autoGeneratePages, setAutoGeneratePages] = useState(false);
  const [regenerateAllPages, setRegenerateAllPages] = useState(false);
  const [regenerateCursor, setRegenerateCursor] = useState<number>(1);
  const [pageScriptEditedAt, setPageScriptEditedAt] = useState<Record<number, number>>({});
  const [pageStyleOverrides, setPageStyleOverrides] = useState<Record<number, SeriesSpec["anchors"]["style"]>>({});
  const [pageStyleEditedAt, setPageStyleEditedAt] = useState<Record<number, number>>({});
  const [globalStyleEditedAt, setGlobalStyleEditedAt] = useState<number>(0);
  const [pageRenderedAt, setPageRenderedAt] = useState<Record<number, number>>({});
  const [pageRenderedImageSize, setPageRenderedImageSize] = useState<Record<number, ImageSize>>({});
  const [pageRenderedEngineKey, setPageRenderedEngineKey] = useState<Record<number, string>>({});
  const [pageScriptEditorOpen, setPageScriptEditorOpen] = useState(false);
  const [pageScriptDraft, setPageScriptDraft] = useState<PageSpec | null>(null);
  const [pageEditActionOpen, setPageEditActionOpen] = useState(false);
  const [pageEditTargetIndex, setPageEditTargetIndex] = useState<number | null>(null);
  const [pageStyleEditorOpen, setPageStyleEditorOpen] = useState(false);
  const [pageStyleTargetIndex, setPageStyleTargetIndex] = useState<number | null>(null);
  const [generationSettingsOpen, setGenerationSettingsOpen] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const generationRunIdRef = useRef(0);
  const isGeneratingPageRef = useRef(false);
  const lastNonErrorStatusRef = useRef<AppStatus>(AppStatus.IDLE);

  useEffect(() => {
    try {
      localStorage.setItem("toon_for_codex_ui_language", uiLanguage);
    } catch { }
  }, [uiLanguage]);

  const ui = (ko: string, en: string): string => uiLanguage === "ko" ? ko : en;

  useEffect(() => {
    if (status !== AppStatus.ERROR) lastNonErrorStatusRef.current = status;
  }, [status]);

  const getPreviousStepStatus = (s: AppStatus): AppStatus | null => {
    switch (s) {
      case AppStatus.CHARACTER_SELECT:
        return AppStatus.STYLE_SELECT;
      case AppStatus.STYLE_SELECT:
        return AppStatus.TOPIC_INPUT;
      case AppStatus.PLANNING:
        return AppStatus.CHARACTER_SELECT;
      case AppStatus.PLAN_REVIEW:
        return AppStatus.CHARACTER_SELECT;
      case AppStatus.READY_TO_GENERATE:
      case AppStatus.GENERATING_PANELS:
        return AppStatus.PLAN_REVIEW;
      default:
        return null;
    }
  };

  const cancelInFlightGeneration = () => {
    generationRunIdRef.current += 1;
    setAutoGeneratePages(false);
    setRegenerateAllPages(false);
    setRegenerateCursor(1);
    setIsProcessingPageIndex(null);
  };

  const goPreviousStep = () => {
    const effectiveStatus = status === AppStatus.ERROR ? lastNonErrorStatusRef.current : status;
    const prev = getPreviousStepStatus(effectiveStatus);
    if (!prev) return;

    if (
      effectiveStatus === AppStatus.PLANNING ||
      effectiveStatus === AppStatus.READY_TO_GENERATE ||
      effectiveStatus === AppStatus.GENERATING_PANELS
    ) {
      cancelInFlightGeneration();
    }

    setSystemError(null);
    setStatus(prev);
  };

  const PreviousStepButton: React.FC<{ className?: string }> = ({ className }) => {
    const effectiveStatus = status === AppStatus.ERROR ? lastNonErrorStatusRef.current : status;
    const canGoBack = Boolean(getPreviousStepStatus(effectiveStatus));
    return (
      <button
        type="button"
        onClick={goPreviousStep}
        disabled={!canGoBack}
        className={`text-[10px] md:text-xs font-black uppercase flex items-center gap-1 transition-colors ${canGoBack ? "text-slate-500 hover:text-black" : "text-slate-300 cursor-not-allowed"
          } ${className || ""}`}
      >
        <ChevronLeft size={14} />
        {ui("이전 단계", "Back")}
      </button>
    );
  };

  useEffect(() => {
    if ((audienceLevel === "kids" || audienceLevel === "teen") && deliveryStyleId === "sensual_pg13") {
      setDeliveryStyleId("standard");
    }
  }, [audienceLevel, deliveryStyleId]);

  useEffect(() => {
    persistCastPresets(castPresets);
  }, [castPresets]);

  useEffect(() => {
    persistSavedComicProjects(savedProjects);
  }, [savedProjects]);

  useEffect(() => {
    if (!selectedCastPresetId && castPresets.length > 0) {
      setSelectedCastPresetId(castPresets.slice().sort((a, b) => b.updated_at - a.updated_at)[0]?.id || "");
    }
  }, [castPresets, selectedCastPresetId]);

  useEffect(() => {
    if (savedProjects.length === 0) {
      if (selectedSavedProjectId) setSelectedSavedProjectId("");
      return;
    }
    const exists = savedProjects.some((p) => p.id === selectedSavedProjectId);
    if (!exists) {
      setSelectedSavedProjectId(savedProjects[0]?.id || "");
    }
  }, [savedProjects, selectedSavedProjectId]);

  useEffect(() => {
    const init = async () => {
      let localApiAvailable = false;
      try {
        await getJson<HealthResponse>("/api/health");
        localApiAvailable = true;
      } catch (e) {
        console.warn("Local API health check failed. Is the backend running?", e);
      }
      setHasApiKey(localApiAvailable);

      const styles = await getStylePresets();
      setStylePresets(styles);
      try {
        const tResp = await fetch('/layout_templates.json');
        if (tResp.ok) {
          setTemplates(await tResp.json());
        }
      } catch (e) {
        console.error("Layout templates fetch failed", e);
      }

      if (localApiAvailable) {
        setStatus(AppStatus.TOPIC_INPUT);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (researchMode !== 'user') {
      setResearchReportText("");
      setResearchReportFile(null);
      setResearchDigestText("");
      setResearchDigestSources([]);
      setResearchDigestWarnings([]);
      setResearchDigestError(null);
      setPageSuggestions(null);
      setIsResearchAnalyzing(false);
    }
  }, [researchMode]);

  useEffect(() => {
    if (creationType !== "educational") return;
    if (comicMode === "pure_cinematic") {
      setComicMode("learning");
      return;
    }
    setResearchDigestText("");
    setResearchDigestSources([]);
    setResearchDigestWarnings([]);
    setResearchDigestError(null);
    setPageSuggestions(null);
  }, [creationType, topic, questionType, comicMode, narrativeRole, introStyle]);

  useEffect(() => {
    if (creationType !== "paper") return;
    setComicMode("learning");
    const nextPublicationFormat = normalizeSelectablePublicationFormat(publicationFormat, creationType);
    if (nextPublicationFormat !== publicationFormat) setPublicationFormat(nextPublicationFormat);
    setLanguage("ko");
    setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
    setImageSize("2K");
    setToneMode("normal");
  }, [creationType, publicationFormat]);

  useEffect(() => {
    const nextPublicationFormat = normalizeSelectablePublicationFormat(publicationFormat, creationType);
    if (nextPublicationFormat !== publicationFormat) setPublicationFormat(nextPublicationFormat);
  }, [creationType, publicationFormat]);

  useEffect(() => {
    if (stylePresets.length === 0) return;
    const allCategories = Array.from(
      new Set(stylePresets.map((p) => p.category || "Uncategorized"))
    );
    if (!allCategories.includes(selectedStyleCategory)) {
      setSelectedStyleCategory(allCategories[0] || "Webtoon");
    }
  }, [selectedStyleCategory, stylePresets]);

  useEffect(() => {
    if (stylePresets.length === 0) return;
    const filtered = stylePresets.filter(
      (p) => (p.category || "Uncategorized") === selectedStyleCategory
    );
    if (filtered.length === 0) return;
    if (!filtered.some((p) => p.id === selectedPresetId)) {
      setSelectedPresetId(filtered[0].id);
    }
  }, [selectedPresetId, selectedStyleCategory, stylePresets]);

  useEffect(() => {
    if (pageCountMode !== "auto") return;
    const fallback = scriptDetail === "brief" ? 1 : scriptDetail === "normal" ? 2 : 3;
    const suggestions =
      creationType === "story"
        ? storyPageSuggestions
        : creationType === "paper"
          ? paperBrief?.page_suggestions || null
          : pageSuggestions;
    const suggested = suggestions?.[scriptDetail];
    setTargetPageCount(clampPageCount(typeof suggested === "number" ? suggested : fallback));
  }, [pageCountMode, scriptDetail, pageSuggestions, storyPageSuggestions, creationType, paperBrief]);

  const handleImageSizeChange = (nextSize: ImageSize) => {
    if (nextSize === imageSize) return;
    setImageSize(nextSize);
    setSeriesPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        series_spec: {
          ...prev.series_spec,
          constraints: {
            ...prev.series_spec.constraints,
            image_size: nextSize
          }
        }
      };
    });
  };

  const handleImageProviderChange = (_nextProvider: ImageProvider) => {
    const resolvedProvider: ImageProvider = "codex";
    if (resolvedProvider === imageProvider) return;
    setImageProvider(resolvedProvider);
    setSeriesPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        series_spec: {
          ...prev.series_spec,
          constraints: {
            ...prev.series_spec.constraints,
            image_provider: resolvedProvider
          }
        }
      };
    });
  };

  const handleCodexImageQualityChange = (nextQuality: CodexImageQuality) => {
    if (nextQuality === codexImageQuality) return;
    setCodexImageQuality(nextQuality);
    setSeriesPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        series_spec: {
          ...prev.series_spec,
          constraints: {
            ...prev.series_spec.constraints,
            codex_image_quality: nextQuality
          }
        }
      };
    });
  };

  const resetApp = () => {
    generationRunIdRef.current += 1;
    setAutoGeneratePages(false);
    setRegenerateAllPages(false);
    setRegenerateCursor(1);
    setSystemError(null);
    setGeminiReasoningEffort("medium");
    setTopic("");
    setQuestionType("explain");
    setScriptDetail("normal");
    setPageCountMode("auto");
    setTargetPageCount(2);
    setPublicationFormat("learning_comic");
    setMangaColorMode("bw");
    setI2VAspectRatio("16:9");
    setToneMode("normal");
    setToneLevel("medium");
    setLanguage("ko");
    setBusyPhase("planning");
    setImageProvider(DEFAULT_IMAGE_PROVIDER);
    setCodexImageQuality(DEFAULT_CODEX_IMAGE_QUALITY);
    setCharacterInputMode("suggest");
    setNarrativeRole("narrator");
    setCharacterConsistencyMode("loose");
    setUseCrossPageStyleConsistency(true);
    setResearchMode("auto_digest");
    setResearchReportText("");
    setResearchReportFile(null);
    setResearchDigestText("");
    setResearchDigestSources([]);
    setResearchDigestWarnings([]);
    setResearchDigestError(null);
    setPageSuggestions(null);
    setIsResearchAnalyzing(false);
    setPaperFile(null);
    setPaperUrl("");
    setPaperBrief(null);
    setPaperBriefError(null);
    setIsPaperAnalyzing(false);
    setCast([createCharacter("protagonist")]);
    setProductReferenceImages([]);
    setActiveProjectId("");
    setSelectedPresetId("kwebtoon_clean_pastel");
    setFinalStyle(null);
    setStyleReferenceImage(null);
    setStyleReferenceError(null);
    setSeriesPlan(null);
    setPageResults([]);
    setPageErrors({});
    setWebtoonEpisodeResult(null);
    setIsBuildingWebtoonEpisode(false);
    setPageRenderedAt({});
    setPageRenderedImageSize({});
    setPageRenderedEngineKey({});
    setPageScriptEditedAt({});
    setPageStyleOverrides({});
    setPageStyleEditedAt({});
    setGlobalStyleEditedAt(0);
    setIsProcessingPageIndex(null);
    setPageScriptEditorOpen(false);
    setPageScriptDraft(null);
    setPageEditActionOpen(false);
    setPageEditTargetIndex(null);
    setPageStyleEditorOpen(false);
    setPageStyleTargetIndex(null);
    setStatus(AppStatus.TOPIC_INPUT);
  };

  const suggestSavedProjectLabel = (): string => {
    const titleFromPlan = String(seriesPlan?.series_spec?.series?.title || "").trim();
    const titleFromTopic = String(topic || "").trim();
    return titleFromPlan || titleFromTopic || "새 만화 프로젝트";
  };

  const buildSavedProjectSnapshot = (): SavedComicProjectSnapshot | null => {
    if (!seriesPlan) return null;

    const compactFinalStyle = compactStyleForStorage(finalStyle || seriesPlan.series_spec.anchors.style);

    return {
      topic,
      questionType,
      comicMode,
      outputMode: toLegacyOutputMode(publicationFormat),
      publicationFormat,
      mangaColorMode,
      i2vAspectRatio,
      toneMode,
      toneLevel,
      introStyle,
      language,
      audienceLevel,
      deliveryStyleId,
      deliveryCustomInstruction,
      geminiReasoningEffort,
      layoutVariety,
      imageSize,
      imageProvider,
      codexImageQuality,
      scriptDetail,
      pageCountMode,
      targetPageCount,
      narrativeRole,
      characterConsistencyMode,
      useCrossPageStyleConsistency,
      researchMode,
      researchDigestText,
      cast: compactCastForStorage(cast),
      productReferenceImages: pickPersistableImageUrls(
        productReferenceImages,
        MAX_PERSISTABLE_PRODUCT_REF_IMAGES
      ),
      selectedPresetId,
      selectedStyleCategory,
      finalStyle: compactFinalStyle,
      seriesPlan: compactSeriesPlanForStorage(seriesPlan),
      pageScriptEditedAt,
      pageStyleOverrides: compactStyleOverrideRecordForStorage(pageStyleOverrides),
      pageStyleEditedAt,
      globalStyleEditedAt,
      creationType,
      scriptText,
      storyInputType,
      ageRating,
      storyGenre,
      pacingPreference,
      storyAntiEducationGuardEnabled,
      storyDigestText,
      paperBrief
    };
  };

  const upsertSavedProject = (opts?: { label?: string; forceNew?: boolean; silent?: boolean }) => {
    const snapshot = buildSavedProjectSnapshot();
    if (!snapshot) {
      if (!opts?.silent) setSystemError(ui("저장할 플랜이 없어. 먼저 플랜을 생성해줘.", "No plan to save. Generate a plan first."));
      return;
    }

    const now = Date.now();
    const requestedLabel = String(opts?.label || "").trim();
    setSavedProjects((prev) => {
      const existing = !opts?.forceNew && activeProjectId
        ? prev.find((p) => p.id === activeProjectId)
        : null;
      const fallbackLabel = existing?.label || suggestSavedProjectLabel();
      const resolvedLabel = requestedLabel || fallbackLabel || "새 만화 프로젝트";

      const nextProject: SavedComicProject = existing
        ? {
          ...existing,
          label: resolvedLabel,
          updated_at: now,
          snapshot
        }
        : {
          id: createClientId(),
          label: resolvedLabel,
          created_at: now,
          updated_at: now,
          last_opened_at: now,
          snapshot
        };

      const next = [nextProject, ...prev.filter((p) => p.id !== nextProject.id)].slice(0, MAX_SAVED_PROJECTS);
      setActiveProjectId(nextProject.id);
      setSelectedSavedProjectId(nextProject.id);
      return next;
    });
    if (!opts?.silent) setSystemError(null);
  };

  const promptSaveProject = () => {
    const snapshot = buildSavedProjectSnapshot();
    if (!snapshot) {
      setSystemError(ui("저장할 플랜이 없어. 먼저 플랜을 생성해줘.", "No plan to save. Generate a plan first."));
      return;
    }
    const active = savedProjects.find((p) => p.id === activeProjectId);
    const suggested = active?.label || suggestSavedProjectLabel();
    const entered = window.prompt(ui("프로젝트 이름(저장 라벨)", "Project name (save label)"), suggested);
    if (entered === null) return;
    upsertSavedProject({ label: entered });
  };

  const loadSavedProject = (projectId: string) => {
    const project = savedProjects.find((p) => p.id === projectId);
    if (!project) return;
    const snapshot = project.snapshot;
    if (!snapshot?.seriesPlan) return;

    cancelInFlightGeneration();
    const restoredRawPlan = deepClone(snapshot.seriesPlan);
    const restoredFinalStyle =
      compactStyleForStorage(snapshot.finalStyle || restoredRawPlan?.series_spec?.anchors?.style) ||
      restoredRawPlan?.series_spec?.anchors?.style ||
      null;
    const restoredCast = normalizeCastFromSnapshot(snapshot.cast);
    const restoredCreationType: CreationType = snapshot.creationType || "educational";
    const restoredComicMode = snapshot.comicMode || "learning";
    const restoredOutputMode: OutputMode = snapshot.outputMode || "comic";
    const restoredRawPublicationFormat: PublicationFormat =
      (snapshot as any).publicationFormat || (restoredOutputMode === "kling_i2v" ? "kling_i2v" : "learning_comic");
    const restoredPublicationFormat = normalizeSelectablePublicationFormat(
      restoredRawPublicationFormat,
      restoredCreationType
    );
    const restoredMangaColorMode: MangaColorMode = (snapshot as any).mangaColorMode || "bw";
    const restoredI2VAspectRatio: I2VAspectRatio = snapshot.i2vAspectRatio || "16:9";
    const restoredNarrativeRole = snapshot.narrativeRole || "narrator";
    const restoredCharacterConsistencyMode = snapshot.characterConsistencyMode || "loose";
    const restoredUseCrossPageStyleConsistency = snapshot.useCrossPageStyleConsistency !== false;
    const restoredStoryAntiEducationGuardEnabled =
      typeof snapshot.storyAntiEducationGuardEnabled === "boolean"
        ? snapshot.storyAntiEducationGuardEnabled
        : restoredRawPlan.series_spec.constraints?.story_anti_education_guard !== false;
    const restoredProductReferenceImages = (snapshot.productReferenceImages || [])
      .map((img) => keepPersistableImageUrl(img))
      .filter((img): img is string => Boolean(img));
    const restoredPlan = syncPlanAnchorsFromSnapshot(restoredRawPlan, {
      cast: restoredCast,
      productReferenceImages: restoredProductReferenceImages,
      finalStyle: restoredFinalStyle,
      narrativeRole: restoredNarrativeRole,
      topic: snapshot.topic || "",
      comicMode: restoredComicMode,
      publicationFormat: restoredPublicationFormat,
      i2vAspectRatio: restoredI2VAspectRatio,
      mangaColorMode: restoredMangaColorMode,
      imageProvider:
        snapshot.imageProvider ||
        restoredRawPlan.series_spec.constraints?.image_provider ||
        DEFAULT_IMAGE_PROVIDER,
      codexImageQuality:
        snapshot.codexImageQuality ||
        snapshot.openAiImageQuality ||
        restoredRawPlan.series_spec.constraints?.codex_image_quality ||
        restoredRawPlan.series_spec.constraints?.openai_image_quality ||
        DEFAULT_CODEX_IMAGE_QUALITY,
      characterConsistencyMode: restoredCharacterConsistencyMode,
      storyAntiEducationGuardEnabled: restoredStoryAntiEducationGuardEnabled
    });
    const restoredImageSize = snapshot.imageSize || restoredPlan.series_spec.constraints.image_size || "1K";
    const restoredImageProvider: ImageProvider = "codex";
    const restoredCodexImageQuality: CodexImageQuality =
      snapshot.codexImageQuality ||
      snapshot.openAiImageQuality ||
      restoredPlan.series_spec.constraints.codex_image_quality ||
      (restoredPlan.series_spec.constraints as any).openai_image_quality ||
      DEFAULT_CODEX_IMAGE_QUALITY;
    const effectiveRestoredImageProvider: ImageProvider = "codex";
    const syncedRestoredPlan: SeriesPlan = {
      ...restoredPlan,
      series_spec: {
        ...restoredPlan.series_spec,
        constraints: {
          ...restoredPlan.series_spec.constraints,
          image_size: restoredImageSize,
          image_provider: effectiveRestoredImageProvider,
          codex_image_quality: restoredCodexImageQuality
        }
      }
    };

    setSystemError(null);
    setGeminiReasoningEffort(snapshot.geminiReasoningEffort || "medium");
    setTopic(snapshot.topic || "");
    setQuestionType(snapshot.questionType || "explain");
    setComicMode(restoredComicMode);
    setPublicationFormat(restoredPublicationFormat);
    setMangaColorMode(restoredMangaColorMode);
    setI2VAspectRatio(restoredI2VAspectRatio);
    setToneMode(snapshot.toneMode || "normal");
    setToneLevel(snapshot.toneLevel || "medium");
    setIntroStyle(snapshot.introStyle || "standard");
    setLanguage(snapshot.language || restoredPlan.series_spec.series.language || "ko");
    setBusyPhase("planning");
    setAudienceLevel(snapshot.audienceLevel || "beginner");
    setDeliveryStyleId(snapshot.deliveryStyleId || "standard");
    setDeliveryCustomInstruction(snapshot.deliveryCustomInstruction || "");
    setLayoutVariety(snapshot.layoutVariety || DEFAULT_LAYOUT_VARIETY);
    setImageSize(restoredImageSize);
    setImageProvider(effectiveRestoredImageProvider);
    setCodexImageQuality(restoredCodexImageQuality);
    setScriptDetail(snapshot.scriptDetail || "normal");
    setPageCountMode(snapshot.pageCountMode || "auto");
    setTargetPageCount(clampPageCount(snapshot.targetPageCount || syncedRestoredPlan.series_spec.series.page_count || 2));
    setNarrativeRole(restoredNarrativeRole);
    setCharacterConsistencyMode(restoredCharacterConsistencyMode);
    setUseCrossPageStyleConsistency(restoredUseCrossPageStyleConsistency);
    setCreationType(restoredCreationType);
    setScriptText(snapshot.scriptText || "");
    setStoryInputType(snapshot.storyInputType || "scenario");
    setAgeRating(snapshot.ageRating || "teen");
    setStoryGenre(snapshot.storyGenre ?? null);
    setPacingPreference(snapshot.pacingPreference || "balanced");
    setStoryAntiEducationGuardEnabled(restoredStoryAntiEducationGuardEnabled);
    setStoryDigestText(snapshot.storyDigestText || "");
    setStoryDigestWarnings([]);
    setStoryDigestError(null);
    setStoryPageSuggestions(null);
    setPaperFile(null);
    setPaperUrl("");
    setPaperBrief(snapshot.paperBrief || null);
    setPaperBriefError(null);
    setIsPaperAnalyzing(false);
    setResearchMode("auto_digest");
    setResearchReportText("");
    setResearchReportFile(null);
    setResearchDigestText(snapshot.researchDigestText || "");
    setResearchDigestSources([]);
    setResearchDigestWarnings([]);
    setResearchDigestError(null);
    setPageSuggestions(null);
    setIsResearchAnalyzing(false);
    setCast(restoredCast);
    setProductReferenceImages(restoredProductReferenceImages);
    setSelectedPresetId(snapshot.selectedPresetId || "kwebtoon_clean_pastel");
    setSelectedStyleCategory(snapshot.selectedStyleCategory || "Webtoon");
    setFinalStyle(restoredFinalStyle);
    setStyleReferenceImage(restoredFinalStyle?.style_reference_image || null);
    setStyleReferenceError(null);
    setSeriesPlan(syncedRestoredPlan);
    setPageResults([]);
    setPageErrors({});
    setWebtoonEpisodeResult(null);
    setIsBuildingWebtoonEpisode(false);
    setPageRenderedAt({});
    setPageRenderedImageSize({});
    setPageRenderedEngineKey({});
    setPageScriptEditedAt(snapshot.pageScriptEditedAt || {});
    setPageStyleOverrides(snapshot.pageStyleOverrides || {});
    setPageStyleEditedAt(snapshot.pageStyleEditedAt || {});
    setGlobalStyleEditedAt(Number(snapshot.globalStyleEditedAt || 0));
    setIsProcessingPageIndex(null);
    setPageScriptEditorOpen(false);
    setPageScriptDraft(null);
    setPageEditActionOpen(false);
    setPageEditTargetIndex(null);
    setPageStyleEditorOpen(false);
    setPageStyleTargetIndex(null);
    setStatus(AppStatus.READY_TO_GENERATE);
    setActiveProjectId(project.id);
    setSelectedSavedProjectId(project.id);

    const now = Date.now();
    setSavedProjects((prev) => {
      const existing = prev.find((p) => p.id === project.id);
      if (!existing) return prev;
      const touched = { ...existing, updated_at: now, last_opened_at: now };
      return [touched, ...prev.filter((p) => p.id !== project.id)].slice(0, MAX_SAVED_PROJECTS);
    });
  };

  const deleteSavedProject = (projectId: string) => {
    const project = savedProjects.find((p) => p.id === projectId);
    if (!project) return;
    if (!window.confirm(`"${project.label}" 프로젝트를 삭제할까요?`)) return;
    setSavedProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) setActiveProjectId("");
    if (selectedSavedProjectId === projectId) setSelectedSavedProjectId("");
  };

  useEffect(() => {
    if (!seriesPlan) return;
    if (!(status === AppStatus.READY_TO_GENERATE || status === AppStatus.GENERATING_PANELS)) return;
    upsertSavedProject({ silent: true });
  }, [
    activeProjectId,
    audienceLevel,
    cast,
    characterConsistencyMode,
    comicMode,
    deliveryCustomInstruction,
    deliveryStyleId,
    finalStyle,
    globalStyleEditedAt,
    imageProvider,
    imageSize,
    introStyle,
    language,
    layoutVariety,
    narrativeRole,
    codexImageQuality,
    geminiReasoningEffort,
    publicationFormat,
    mangaColorMode,
    i2vAspectRatio,
    pageCountMode,
    pageScriptEditedAt,
    pageStyleEditedAt,
    pageStyleOverrides,
    paperBrief,
    productReferenceImages,
    questionType,
    researchDigestText,
    researchMode,
    scriptDetail,
    selectedPresetId,
    selectedStyleCategory,
    seriesPlan,
    status,
    targetPageCount,
    toneLevel,
    toneMode,
    topic,
    storyAntiEducationGuardEnabled,
    useCrossPageStyleConsistency
  ]);

  useEffect(() => {
    if (
      !(
        status === AppStatus.PLAN_REVIEW ||
        status === AppStatus.READY_TO_GENERATE ||
        status === AppStatus.GENERATING_PANELS
      )
    ) {
      return;
    }
    syncSeriesPlanAnchors(cast, productReferenceImages);
  }, [
    cast,
    characterConsistencyMode,
    comicMode,
    publicationFormat,
    mangaColorMode,
    i2vAspectRatio,
    finalStyle,
    narrativeRole,
    productReferenceImages,
    storyAntiEducationGuardEnabled,
    status,
    topic
  ]);

  const updateCastMember = (id: string, patch: Partial<CharacterSpec>) => {
    setCast((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCastMember = (role: CastRole) => {
    setCast((prev) => {
      const protagonistCount = prev.filter((c) => c.role === "protagonist").length;
      if (role === "protagonist" && protagonistCount >= 2) {
        setSystemError(ui("주연(주인공)은 최대 2명까지 가능해.", "You can have up to 2 lead characters."));
        return prev;
      }
      setSystemError(null);
      return [...prev, createCharacter(role)];
    });
  };

  const removeCastMember = (id: string) => {
    setCast((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      if (target.role === "protagonist") {
        const protagonistCount = prev.filter((c) => c.role === "protagonist").length;
        if (protagonistCount <= 1) {
          setSystemError(ui("주연(주인공)은 최소 1명은 있어야 해.", "You need at least 1 lead character."));
          return prev;
        }
      }
      setSystemError(null);
      return prev.filter((c) => c.id !== id);
    });
  };

  const readFileAsDataUrlRaw = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      r.onload = () => resolve(String(r.result || ""));
      r.readAsDataURL(file);
    });
  };

  const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      img.src = dataUrl;
    });
  };

  const compressImageDataUrl = async (
    dataUrl: string,
    options: { maxEdge: number; maxLength: number; quality: number }
  ): Promise<string> => {
    if (!isDataUrl(dataUrl)) return dataUrl;
    if (!/^data:image\//i.test(dataUrl)) return dataUrl;
    if (/^data:image\/(gif|svg\+xml)/i.test(dataUrl)) return dataUrl;
    if (dataUrl.length <= options.maxLength) return dataUrl;

    try {
      const img = await loadImageFromDataUrl(dataUrl);
      const sourceW = img.naturalWidth || img.width;
      const sourceH = img.naturalHeight || img.height;
      if (!sourceW || !sourceH) return dataUrl;

      const renderJpeg = (w: number, h: number, quality: number): string | null => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return canvas.toDataURL("image/jpeg", quality);
      };

      const initialScale = Math.min(1, options.maxEdge / Math.max(sourceW, sourceH));
      let targetW = Math.max(1, Math.round(sourceW * initialScale));
      let targetH = Math.max(1, Math.round(sourceH * initialScale));
      let quality = options.quality;
      let best = dataUrl;

      for (let pass = 0; pass < 5; pass += 1) {
        const compressed = renderJpeg(targetW, targetH, quality);
        if (!compressed) break;
        if (compressed.length < best.length) best = compressed;
        if (compressed.length <= options.maxLength) return compressed;

        quality = Math.max(0.55, quality - 0.12);
        targetW = Math.max(1, Math.round(targetW * 0.82));
        targetH = Math.max(1, Math.round(targetH * 0.82));
      }

      return best.length < dataUrl.length ? best : dataUrl;
    } catch {
      return dataUrl;
    }
  };

  const compressReferenceDataUrl = async (dataUrl: string): Promise<string> => {
    return compressImageDataUrl(dataUrl, {
      maxEdge: REFERENCE_IMAGE_MAX_EDGE,
      maxLength: MAX_PERSISTABLE_DATA_URL_LENGTH,
      quality: REFERENCE_IMAGE_JPEG_QUALITY,
    });
  };

  const readFileAsDataUrl = async (file: File): Promise<string> => {
    const raw = await readFileAsDataUrlRaw(file);
    return compressReferenceDataUrl(raw);
  };

  const MAX_REF_IMAGES_PER_CHARACTER = 4;
  const MAX_REF_IMAGE_BYTES = 6 * 1024 * 1024; // 6MB
  const MAX_PRODUCT_REF_IMAGES = 2;

  const syncSeriesPlanAnchors = (
    nextCast: CharacterSpec[],
    nextProductReferenceImages: string[]
  ) => {
    setSeriesPlan((prev) => {
      if (!prev) return prev;
      return syncPlanAnchorsFromSnapshot(prev, {
        cast: nextCast,
        productReferenceImages: nextProductReferenceImages,
        finalStyle: finalStyle || prev.series_spec.anchors.style,
        narrativeRole,
        topic,
        comicMode,
        publicationFormat,
        mangaColorMode,
        i2vAspectRatio,
        imageProvider,
        codexImageQuality,
        characterConsistencyMode,
        storyAntiEducationGuardEnabled
      });
    });
  };

  const addProductReferenceImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    const oversized = fileArray.find((f) => f.size > MAX_REF_IMAGE_BYTES);
    if (oversized) {
      setSystemError(ui("이미지 용량이 너무 커. 6MB 이하로 업로드해줘.", "Image is too large. Upload an image under 6MB."));
      return;
    }

    const capacity = Math.max(0, MAX_PRODUCT_REF_IMAGES - productReferenceImages.length);
    const toRead = fileArray.slice(0, capacity);
    if (toRead.length === 0) {
      setSystemError(ui(`상품 레퍼런스 이미지는 최대 ${MAX_PRODUCT_REF_IMAGES}장까지 가능해.`, `Product reference images are limited to ${MAX_PRODUCT_REF_IMAGES}.`));
      return;
    }

    try {
      setSystemError(null);
      const urls = await Promise.all(toRead.map(readFileAsDataUrl));
      setProductReferenceImages((prev) => [...prev, ...urls].filter(Boolean));
    } catch (e: any) {
      setSystemError(e?.message || ui("이미지 업로드에 실패했어.", "Image upload failed."));
    }
  };

  const removeProductReferenceImage = (index: number) => {
    setProductReferenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const addReferenceImages = async (id: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    const oversized = fileArray.find((f) => f.size > MAX_REF_IMAGE_BYTES);
    if (oversized) {
      setSystemError(ui("이미지 용량이 너무 커. 6MB 이하로 업로드해줘.", "Image is too large. Upload an image under 6MB."));
      return;
    }

    const current = cast.find((c) => c.id === id);
    const currentCount = current?.reference_images?.length || 0;
    const capacity = Math.max(0, MAX_REF_IMAGES_PER_CHARACTER - currentCount);
    const toRead = fileArray.slice(0, capacity);
    if (toRead.length === 0) {
      setSystemError(ui(`캐릭터당 레퍼런스 이미지는 최대 ${MAX_REF_IMAGES_PER_CHARACTER}장까지 가능해.`, `Reference images are limited to ${MAX_REF_IMAGES_PER_CHARACTER} per character.`));
      return;
    }

    try {
      setSystemError(null);
      const urls = await Promise.all(toRead.map(readFileAsDataUrl));
      setCast((prev) =>
        prev.map((c) => (c.id === id ? {
          ...c,
          reference_images: [...(c.reference_images || []), ...urls].filter(Boolean),
          style_aligned_reference_images: [],
          style_aligned_reference_style_key: undefined
        } : c))
      );

      // Auto-analyze the first uploaded image to extract structured appearance attributes
      const firstNewUrl = urls.find(Boolean);
      if (firstNewUrl) {
        analyzeCharacterImage(firstNewUrl).then((analyzed) => {
          if (analyzed) {
            setCast((prev) =>
              prev.map((c) => (c.id === id ? { ...c, analyzed_appearance: analyzed } : c))
            );
            console.log(`[addReferenceImages] Auto-analyzed character ${id}:`, analyzed);
          }
        }).catch(() => { /* silent — manual appearance is the fallback */ });
      }
    } catch (e: any) {
      setSystemError(e?.message || ui("이미지 업로드에 실패했어.", "Image upload failed."));
    }
  };

  const removeReferenceImage = (id: string, index: number) => {
    setCast((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const remaining = (c.reference_images || []).filter((_: string, i: number) => i !== index);
        const removed = (c.reference_images || [])[index];
        const remainingStyleAligned = (c.style_aligned_reference_images || []).filter((url) => url !== removed);
        return {
          ...c,
          reference_images: remaining,
          style_aligned_reference_images: remaining.length > 0 ? remainingStyleAligned : [],
          style_aligned_reference_style_key: remaining.length > 0 && remainingStyleAligned.length > 0 ? c.style_aligned_reference_style_key : undefined,
          ...(remaining.length === 0 ? { analyzed_appearance: undefined } : {})
        };
      })
    );
  };

  const clearStyleAlignedReference = (id: string) => {
    setCast((prev) =>
      prev.map((c) => (c.id === id ? {
        ...c,
        style_aligned_reference_images: [],
        style_aligned_reference_style_key: undefined
      } : c))
    );
    setCharacterReferenceErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const buildContentSourceForCast = (): { label: string; text: string } => {
    if (creationType === "story") {
      const digest = storyDigestText.trim();
      const original = scriptText.trim();
      if (digest && original) {
        return {
          label: ui("스토리 분석본+원문", "Story digest + original"),
          text: [
            "[STORY DIGEST]",
            digest,
            "",
            "[ORIGINAL STORY EXCERPT]",
            original.slice(0, 50000)
          ].join("\n")
        };
      }
      if (digest) return { label: ui("스토리 분석본", "Story digest"), text: digest };
      return { label: ui("원문 스토리", "Original story"), text: scriptText.trim() };
    }

    if (creationType === "paper") {
      if (!paperBrief) return { label: ui("논문 브리프", "Paper brief"), text: "" };
      return {
        label: ui("논문 브리프", "Paper brief"),
        text: [
          paperBrief.paper_title,
          paperBrief.one_line_takeaway,
          paperBrief.motivation_context,
          ...(paperBrief.opening_candidates || []),
          ...(paperBrief.paper_story_units || []).map((unit) => `${unit.step}: ${unit.reader_question}`),
          paperBrief.core_problem,
          paperBrief.method_summary,
          paperBrief.result_summary,
          ...(paperBrief.main_contributions || []),
          ...(paperBrief.limitations || [])
        ].filter(Boolean).join("\n")
      };
    }

    const digest = researchDigestText.trim();
    if (digest) return { label: ui("GPT 다이제스트", "GPT digest"), text: digest };
    const userReport = researchReportText.trim();
    if (userReport) return { label: ui("업로드 자료", "Uploaded material"), text: userReport };
    return { label: ui("주제", "Topic"), text: topic.trim() };
  };

  const resolveCurrentStyle = (): SeriesSpec["anchors"]["style"] => ({
    ...selectStyle(stylePresets, selectedPresetId, "", { publicationFormat, mangaColorMode }),
    style_reference_image: styleReferenceImage
  });

  const getCurrentReferenceStyle = (): SeriesSpec["anchors"]["style"] => finalStyle || resolveCurrentStyle();

  const applyContentCastSuggestions = async () => {
    if (isSuggestingCastFromContent) return;
    if (!hasApiKey) {
      const message = ui("캐릭터 제안에는 로컬 서버와 Codex 로그인이 필요해.", "Character suggestions require the local server and Codex login.");
      setCastSuggestionNotice({
        kind: "error",
        message,
        detail: ui("`npm run dev`와 `npx @openai/codex login` 상태를 확인해줘.", "Check `npm run dev` and `npx @openai/codex login`.")
      });
      setSystemError(message);
      return;
    }

    const source = buildContentSourceForCast();
    if (!source.text || source.text.length < 2) {
      const message = ui("먼저 주제, 다이제스트, 스토리, 논문 브리프 중 하나가 필요해.", "Add a topic, digest, story, or paper brief first.");
      setCastSuggestionNotice({ kind: "error", message });
      setSystemError(message);
      return;
    }

    setIsSuggestingCastFromContent(true);
    setSystemError(null);
    setCastSuggestionNotice({
      kind: "info",
      message: ui("자료를 읽고 캐릭터 후보를 뽑는 중이야.", "Reading the material and drafting character candidates."),
      detail: ui(`사용 자료: ${source.label}`, `Source: ${source.label}`)
    });
    try {
      const selectedStyle = resolveCurrentStyle();
      const suggestions = await suggestCastFromContent({
        source_text: source.text,
        creation_type: creationType,
        publication_format: publicationFormat,
        audience_level: audienceLevel,
        source_label: source.label,
        story_genre: storyGenre || undefined,
        story_input_type: storyInputType,
        age_rating: ageRating,
        pacing: pacingPreference,
        existing_cast: cast,
        selected_style: {
          preset_id: selectedStyle.preset_id,
          preset_label: selectedStyle.preset_label,
          render_mode: selectedStyle.render_mode,
          style_prompt: selectedStyle.style_prompt,
          user_style_prompt: selectedStyle.user_style_prompt
        }
      });

      if (suggestions.length === 0) {
        const message = ui("자료에서 캐릭터 후보를 찾지 못했어.", "Could not find character candidates from the material.");
        setCastSuggestionNotice({
          kind: "error",
          message,
          detail: ui(
            `사용 자료: ${source.label}. 자료가 너무 짧거나 인물/역할 단서가 부족하면 빈 결과가 나올 수 있어.`,
            `Source: ${source.label}. This can happen when the material is too short or has too few character/role cues.`
          )
        });
        setSystemError(message);
        return;
      }

      const mapped = suggestions.map((c) => ({
        ...createCharacter(c.role, c.name),
        appearance: c.appearance || c.visual_prompt,
        persona: [c.persona, c.story_function].filter(Boolean).join("\n"),
        catchphrase: c.catchphrase || "",
        catchphrase_frequency: "rare" as CatchphraseFrequency,
        reference_images: []
      }));
      const protagonists = mapped.filter((c) => c.role === "protagonist").slice(0, 2);
      const supporting = mapped.filter((c) => c.role === "supporting");
      setCast(protagonists.length > 0 ? [...protagonists, ...supporting] : [createCharacter("protagonist"), ...supporting]);
      setCharacterConsistencyMode("strict");
      setCastSuggestionNotice({
        kind: "success",
        message: ui(`AI 캐릭터 제안 ${mapped.length}명을 적용했어.`, `Applied ${mapped.length} AI character suggestion${mapped.length === 1 ? "" : "s"}.`),
        detail: ui(`사용 자료: ${source.label}`, `Source: ${source.label}`)
      });
      setSystemError(null);
    } catch (e: any) {
      const detail = toUserFacingError(
        e?.message,
        ui("캐릭터 제안 생성에 실패했어.", "Character suggestion failed."),
        uiLanguage
      );
      setCastSuggestionNotice({
        kind: "error",
        message: ui("AI 캐릭터 제안 적용에 실패했어.", "Could not apply AI character suggestions."),
        detail
      });
      setSystemError(detail);
    } finally {
      setIsSuggestingCastFromContent(false);
    }
  };

  const generateReferenceImageForCharacter = async (id: string) => {
    if (generatingCharacterImageIds[id]) return;
    if (!hasApiKey) {
      setSystemError(ui("AI 캐릭터 이미지 생성에는 로컬 서버와 Codex 로그인이 필요해.", "AI character image generation requires the local server and Codex login."));
      return;
    }

    const target = cast.find((c) => c.id === id);
    if (!target) return;
    const currentRefs = (target.reference_images || []).filter(Boolean);
    const styleAlignedRefSet = new Set((target.style_aligned_reference_images || []).filter(Boolean));
    const sourceIdentityRefs = currentRefs.filter((url) => !styleAlignedRefSet.has(url));

    const selectedStyle = getCurrentReferenceStyle();
    const selectedStyleKey = buildStyleReferenceKey(selectedStyle);
    const contentSource = buildContentSourceForCast();
    const genreEraLock = buildGenreEraLockForCharacter(contentSource.text);
    const identityProfile = String(target.analyzed_appearance || "").trim();
    const manualAppearance = String(target.appearance || "").trim();
    const description = [
      `Source material type: ${contentSource.label}`,
      `Creation type: ${creationType}`,
      `Publication format: ${publicationFormat}`,
      `Story genre setting: ${storyGenre || "unspecified"}`,
      `World / era lock: ${genreEraLock}`,
      `Name/title: ${String(target.name || "").trim() || (target.role === "protagonist" ? "Protagonist" : "Supporting character")}`,
      `Role: ${target.role}`,
      `Identity profile from uploaded reference: ${identityProfile || "none"}`,
      `Manual appearance notes: ${manualAppearance || "none"}`,
      `Appearance to preserve: ${identityProfile || manualAppearance || "clear readable character design"}`,
      `Persona: ${String(target.persona || "").trim() || "recurring comic character"}`,
      `Style direction: ${selectedStyle.style_prompt}`,
      selectedStyle.user_style_prompt ? `Style addition: ${selectedStyle.user_style_prompt}` : "",
      "If uploaded identity references are attached, use them only for likeness/identity. Ignore their original photo look, illustration medium, linework, lighting, color grading, texture, and rendering style.",
      `Source excerpt for genre fidelity: ${contentSource.text.slice(0, 2500)}`,
      "Do not modernize the character. Do not invent a business suit, blazer, necktie, office-worker outfit, school uniform, or contemporary street fashion unless explicitly required by the source.",
      "Create a single clean front-facing character reference sheet. Plain background. No speech bubbles. No text labels."
    ].filter(Boolean).join("\n");

    setGeneratingCharacterImageIds((prev) => ({ ...prev, [id]: true }));
    setSystemError(null);
    try {
      const candidates = await generateCharacterCandidates(description, imageSize, 1, {
        identityReferenceImages: sourceIdentityRefs.length > 0 ? sourceIdentityRefs : currentRefs
      });
      const imageUrl = candidates[0]?.preview_url || "";
      if (!imageUrl.startsWith("data:")) {
        throw new Error(ui("캐릭터 이미지를 생성하지 못했어.", "Could not generate the character image."));
      }
      const compressed = await compressReferenceDataUrl(imageUrl);
      setCharacterReferenceErrors((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setCast((prev) =>
        prev.map((c) => (c.id === id ? {
          ...c,
          reference_images: [
            ...(c.reference_images || []).filter(Boolean).slice(0, MAX_REF_IMAGES_PER_CHARACTER - 1),
            compressed
          ],
          style_aligned_reference_images: [compressed],
          style_aligned_reference_style_key: selectedStyleKey
        } : c))
      );
      setCharacterConsistencyMode("strict");
    } catch (e: any) {
      setSystemError(e?.message || ui("AI 캐릭터 이미지 생성에 실패했어.", "AI character image generation failed."));
    } finally {
      setGeneratingCharacterImageIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const styleReferenceImageForCharacter = async (id: string) => {
    if (stylingCharacterImageIds[id]) return;
    if (!hasApiKey) {
      const message = ui("그림체 변환에는 로컬 서버와 Codex 로그인이 필요해.", "Style conversion requires the local server and Codex login.");
      setCharacterReferenceErrors((prev) => ({ ...prev, [id]: message }));
      setSystemError(message);
      return;
    }

    const target = cast.find((c) => c.id === id);
    if (!target) return;
    const refs = (target.reference_images || []).filter(Boolean);
    if (refs.length === 0) {
      const message = ui("먼저 캐릭터 레퍼런스 이미지를 추가해줘.", "Add a character reference image first.");
      setCharacterReferenceErrors((prev) => ({ ...prev, [id]: message }));
      return;
    }

    const style = getCurrentReferenceStyle();
    const styleKey = buildStyleReferenceKey(style);
    setStylingCharacterImageIds((prev) => ({ ...prev, [id]: true }));
    setCharacterReferenceErrors((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSystemError(null);

    try {
      const generated = await generateStyleAlignedCharacterReference({
        characterName: target.name,
        identityProfile: target.analyzed_appearance,
        manualAppearance: target.appearance,
        stylePrompt: style.style_prompt,
        userStylePrompt: style.user_style_prompt,
        imageSize,
        identityReferenceImages: refs
      });
      if (!generated) {
        throw new Error(ui("현재 그림체 변환 결과가 비어 있어.", "The style conversion returned no image."));
      }

      const compressed = await compressReferenceDataUrl(generated);
      setCast((prev) =>
        prev.map((c) => (c.id === id ? {
          ...c,
          style_aligned_reference_images: [compressed],
          style_aligned_reference_style_key: styleKey
        } : c))
      );
      setCharacterConsistencyMode("strict");
    } catch (e: any) {
      const message = e?.message || ui("현재 그림체 변환에 실패했어.", "Style conversion failed.");
      setCharacterReferenceErrors((prev) => ({ ...prev, [id]: message }));
    } finally {
      setStylingCharacterImageIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const renderCharacterReferenceControls = (
    c: CharacterSpec,
    options: {
      inputId: string;
      displayName: string;
      altFallback: string;
      panelClassName: string;
      titleClassName: string;
      countClassName: string;
      uploadDisabled?: boolean;
      compact?: boolean;
    }
  ) => {
    const refs = (c.reference_images || []).filter(Boolean);
    const currentStyleKey = buildStyleReferenceKey(getCurrentReferenceStyle());
    const currentStyleAlignedRefs = c.style_aligned_reference_style_key === currentStyleKey
      ? (c.style_aligned_reference_images || []).filter(Boolean)
      : [];
    const refSet = new Set(refs);
    const detachedStyleAlignedRefs = currentStyleAlignedRefs.filter((url) => !refSet.has(url));
    const hasCurrentStyleAlignedRef = currentStyleAlignedRefs.length > 0;
    const hasAnyStyleAlignedRef = (c.style_aligned_reference_images || []).filter(Boolean).length > 0;
    const isGenerating = Boolean(generatingCharacterImageIds[c.id]);
    const isStyling = Boolean(stylingCharacterImageIds[c.id]);
    const uploadDisabled = Boolean(options.uploadDisabled);
    const buttonTextSize = options.compact ? "text-[10px]" : "text-[10px] md:text-xs";
    const iconSize = options.compact ? 12 : 14;
    const thumbnailIconSize = options.compact ? 10 : 12;

    return (
      <div className={options.panelClassName}>
        <div className="flex items-center justify-between gap-3">
          <p className={options.titleClassName}>{ui("레퍼런스 사진", "Reference Photos")}</p>
          <p className={options.countClassName}>{refs.length}/{MAX_REF_IMAGES_PER_CHARACTER}</p>
        </div>

        <input
          type="file"
          accept="image/*"
          multiple
          id={options.inputId}
          className="hidden"
          disabled={uploadDisabled}
          onChange={(e) => {
            void addReferenceImages(c.id, e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <label
            htmlFor={options.inputId}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 font-black border-2 border-black ${buttonTextSize} ${uploadDisabled ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-black text-white cursor-pointer hover:bg-blue-600 transition-colors"}`}
          >
            <Upload size={iconSize} /> {ui("사진 추가", "Add Photos")}
          </label>
          <button
            type="button"
            onClick={() => void generateReferenceImageForCharacter(c.id)}
            disabled={isGenerating || uploadDisabled}
            className={`inline-flex items-center justify-center gap-2 border-2 border-black bg-white px-4 py-2 font-black hover:bg-yellow-50 transition-colors ${buttonTextSize} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isGenerating ? <Loader2 size={iconSize} className="animate-spin" /> : <Wand2 size={iconSize} />}
            {ui("AI 이미지", "AI Image")}
          </button>
          <button
            type="button"
            onClick={() => void styleReferenceImageForCharacter(c.id)}
            disabled={refs.length === 0 || isStyling || uploadDisabled}
            className={`inline-flex items-center justify-center gap-2 border-2 border-black bg-white px-4 py-2 font-black hover:bg-blue-50 transition-colors ${buttonTextSize} disabled:opacity-50 disabled:cursor-not-allowed`}
            title={ui("업로드한 레퍼런스를 현재 선택한 그림체로 변환", "Convert uploaded references to the selected style")}
          >
            {isStyling ? <Loader2 size={iconSize} className="animate-spin" /> : <Palette size={iconSize} />}
            {hasCurrentStyleAlignedRef
              ? ui("현재 그림체 다시", "Restyle")
              : hasAnyStyleAlignedRef
                ? ui("현재 그림체로 다시", "Restyle Current")
                : ui("현재 그림체로 다듬기", "Style Match")}
          </button>
        </div>

        {hasCurrentStyleAlignedRef ? (
          <p className="mt-2 text-[10px] font-black text-blue-700">{ui("현재 그림체 변환본을 최종 생성에 우선 사용", "Current-style reference is prioritized for final generation")}</p>
        ) : null}
        {characterReferenceErrors[c.id] ? (
          <p className="mt-2 text-[10px] font-bold text-red-600">{characterReferenceErrors[c.id]}</p>
        ) : null}

        {refs.length > 0 ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {refs.map((url, idx) => {
              const isCurrentStyleRef = currentStyleAlignedRefs.includes(url);
              return (
                <div key={`${c.id}_${options.inputId}_${idx}`} className="relative border-2 border-black bg-white overflow-hidden aspect-square">
                  <img src={url} alt={`${options.displayName || options.altFallback} ref ${idx + 1}`} className="w-full h-full object-cover" />
                  {isCurrentStyleRef ? (
                    <span className="absolute bottom-1 left-1 right-1 bg-blue-600 text-white text-[8px] font-black text-center px-1 py-0.5">
                      {ui("현재 그림체", "Styled")}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => downloadReferenceImage(url, c, idx)}
                    className="absolute top-1 left-1 bg-white border-2 border-black p-1 hover:bg-blue-50"
                    title={ui("다운로드", "Download")}
                  >
                    <Download size={thumbnailIconSize} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeReferenceImage(c.id, idx)}
                    disabled={uploadDisabled}
                    className={`absolute top-1 right-1 border-2 border-black p-1 ${uploadDisabled ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
                    title={ui("삭제", "Remove")}
                  >
                    <Trash2 size={thumbnailIconSize} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {detachedStyleAlignedRefs.length > 0 ? (
          <div className="mt-3">
            <p className="mb-2 text-[10px] font-black text-blue-700">{ui("변환된 레퍼런스", "Styled Reference")}</p>
            <div className="grid grid-cols-4 gap-2">
              {detachedStyleAlignedRefs.map((url, idx) => (
                <div key={`${c.id}_${options.inputId}_styled_${idx}`} className="relative border-2 border-blue-600 bg-white overflow-hidden aspect-square">
                  <img src={url} alt={`${options.displayName || options.altFallback} styled reference ${idx + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 right-1 bg-blue-600 text-white text-[8px] font-black text-center px-1 py-0.5">
                    {ui("현재 그림체", "Styled")}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadReferenceImage(url, c, idx)}
                    className="absolute top-1 left-1 bg-white border-2 border-black p-1 hover:bg-blue-50"
                    title={ui("다운로드", "Download")}
                  >
                    <Download size={thumbnailIconSize} />
                  </button>
                  <button
                    type="button"
                    onClick={() => clearStyleAlignedReference(c.id)}
                    disabled={uploadDisabled}
                    className={`absolute top-1 right-1 border-2 border-black p-1 ${uploadDisabled ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
                    title={ui("삭제", "Remove")}
                  >
                    <Trash2 size={thumbnailIconSize} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const buildCastPresetPayload = (): CastPresetPayload => {
    return {
      narrativeRole,
      cast: cast.map((c) => ({
        role: c.role,
        name: String(c.name ?? ""),
        appearance: String(c.appearance ?? ""),
        persona: typeof c.persona === "string" ? c.persona : "",
        catchphrase: typeof c.catchphrase === "string" ? c.catchphrase : "",
        catchphrase_frequency: (c.catchphrase_frequency || "rare") as CatchphraseFrequency
      }))
    };
  };

  const suggestCastPresetLabel = (): string => {
    const protos = cast
      .filter((c) => c.role === "protagonist")
      .map((c) => String(c.name || "").trim())
      .filter(Boolean)
      .slice(0, 2);
    const supportingCount = cast.filter((c) => c.role === "supporting").length;
    const base = protos.length > 0 ? protos.join("+") : "캐스트";
    return supportingCount > 0 ? `${base}+조연${supportingCount}` : base;
  };

  const saveCastPreset = (labelInput?: string) => {
    const label = String(labelInput || "").trim() || suggestCastPresetLabel();
    if (!label) {
      setSystemError(ui("프리셋 이름을 입력해줘.", "Enter a preset name."));
      return;
    }

    const now = Date.now();
    const payload = buildCastPresetPayload();

    setCastPresets((prev) => {
      const existing = prev.find((p) => p.label === label);
      const nextPreset: CastPreset = existing
        ? { ...existing, updated_at: now, payload }
        : { id: createClientId(), label, created_at: now, updated_at: now, payload };

      const withoutExisting = prev.filter((p) => p.id !== nextPreset.id);
      const next = [nextPreset, ...withoutExisting].slice(0, 30);
      setSelectedCastPresetId(nextPreset.id);
      setSystemError(null);
      setCastSuggestionNotice(null);
      return next;
    });
  };

  const promptSaveCastPreset = () => {
    const suggested = suggestCastPresetLabel();
    const entered = window.prompt(ui("프리셋 이름(저장 라벨)", "Preset name (save label)"), suggested);
    if (entered === null) return;
    saveCastPreset(entered);
  };

  const applyCastPreset = (presetId: string) => {
    const preset = castPresets.find((p) => p.id === presetId);
    if (!preset) return;

    const nextNarrativeRole: NarrativeRole =
      preset.payload.narrativeRole === "actor" ? "actor" : "narrator";
    setNarrativeRole(nextNarrativeRole);

    const mapped = (preset.payload.cast || []).map((c) => ({
      id: createClientId(),
      role: c.role,
      name: String(c.name || (c.role === "protagonist" ? "주인공" : "")),
      appearance: String(c.appearance || ""),
      persona: String(c.persona || ""),
      catchphrase: String(c.catchphrase || ""),
      catchphrase_frequency: (c.catchphrase_frequency || "rare") as CatchphraseFrequency,
      reference_images: []
    }));

    const protagonists = mapped.filter((c) => c.role === "protagonist").slice(0, 2);
    const supporting = mapped.filter((c) => c.role === "supporting");
    const nextCast = protagonists.length > 0 ? [...protagonists, ...supporting] : [createCharacter("protagonist"), ...supporting];
    setCast(nextCast);
    setSystemError(null);
    setCastSuggestionNotice(null);
  };

  const applyCastPresetToSection = (presetId: string, role: CastRole) => {
    const preset = castPresets.find((p) => p.id === presetId);
    if (!preset) return;

    if (role === "protagonist") {
      const nextNarrativeRole: NarrativeRole =
        preset.payload.narrativeRole === "actor" ? "actor" : "narrator";
      setNarrativeRole(nextNarrativeRole);
    }

    const mapped = (preset.payload.cast || []).map((c) => ({
      id: createClientId(),
      role: c.role,
      name: String(c.name || (c.role === "protagonist" ? "주인공" : "")),
      appearance: String(c.appearance || ""),
      persona: String(c.persona || ""),
      catchphrase: String(c.catchphrase || ""),
      catchphrase_frequency: (c.catchphrase_frequency || "rare") as CatchphraseFrequency,
      reference_images: []
    }));

    if (role === "protagonist") {
      const nextProtagonists = mapped.filter((c) => c.role === "protagonist").slice(0, 2);
      if (nextProtagonists.length === 0) {
        const message = ui("이 프리셋에는 주연 캐릭터가 없어.", "This preset has no lead character.");
        setSystemError(message);
        setCastSuggestionNotice({ kind: "error", message });
        return;
      }
      const existingSupporting = cast.filter((c) => c.role === "supporting");
      setCast([...nextProtagonists, ...existingSupporting]);
      setSystemError(null);
      setCastSuggestionNotice(null);
      return;
    }

    const existingProtagonists = cast.filter((c) => c.role === "protagonist").slice(0, 2);
    if (existingProtagonists.length === 0) {
      const message = ui("주연(주인공)은 최소 1명은 있어야 해.", "You need at least 1 lead character.");
      setSystemError(message);
      setCastSuggestionNotice({ kind: "error", message });
      return;
    }
    const nextSupporting = mapped.filter((c) => c.role === "supporting");
    setCast([...existingProtagonists, ...nextSupporting]);
    setSystemError(null);
    setCastSuggestionNotice(null);
  };

  const deleteCastPreset = (presetId: string) => {
    const preset = castPresets.find((p) => p.id === presetId);
    if (!preset) return;
    if (!window.confirm(`"${preset.label}" 프리셋을 삭제할까요?`)) return;
    setCastPresets((prev) => prev.filter((p) => p.id !== presetId));
    setSelectedCastPresetId((prev) => (prev === presetId ? "" : prev));
  };

  const clearResearchDigest = () => {
    setResearchDigestText("");
    setResearchDigestSources([]);
    setResearchDigestWarnings([]);
    setResearchDigestError(null);
    setPageSuggestions(null);
  };

  const handleResearchFileChange = async (file: File | null) => {
    setResearchReportFile(file);
    clearResearchDigest();

    if (!file) return;

    const isTextLike =
      file.type.startsWith("text/") ||
      file.name.toLowerCase().endsWith(".md") ||
      file.name.toLowerCase().endsWith(".txt") ||
      file.name.toLowerCase().endsWith(".json");

    if (isTextLike) {
      try {
        const text = await file.text();
        setResearchReportText(text);
      } catch (e) {
        console.warn("Failed to read research file as text", e);
      }
    }
  };

  const handleAnalyzeResearch = async () => {
    if (isResearchAnalyzing) return;
    const materialText = researchReportText.trim();
    const effectiveTopic = topic.trim() || deriveTopicFromMaterial(
      materialText,
      researchReportFile?.name || ui("업로드 자료", "Uploaded material")
    );
    if (!effectiveTopic.trim()) return;
    if (!topic.trim()) setTopic(effectiveTopic);

    setIsResearchAnalyzing(true);
    setResearchDigestError(null);
    setResearchDigestWarnings([]);
    setPageSuggestions(null);

    try {
      const hasUserMaterial = Boolean(researchReportText.trim() || researchReportFile);
      const result = hasUserMaterial
        ? await analyzeResearchReport({
          topic: effectiveTopic,
          question_type: questionType,
          comic_mode: comicMode,
          character_role: narrativeRole,
          intro_style: introStyle,
          report_text: researchReportText,
          file: researchReportFile || undefined
        })
        : await generateGeminiResearchPack({
          topic: effectiveTopic,
          question_type: questionType,
          comic_mode: comicMode,
          character_role: narrativeRole,
          intro_style: introStyle,
          reasoning_effort: geminiReasoningEffort
        });
      const suggestions = result.page_suggestions || null;
      setResearchDigestText(result.notes);
      setResearchDigestSources("sources" in result && Array.isArray(result.sources) ? result.sources : []);
      setResearchDigestWarnings("warnings" in result && Array.isArray(result.warnings) ? result.warnings : []);
      setPageSuggestions(suggestions);
      if (pageCountMode === "auto" && suggestions) {
        const suggested = suggestions[scriptDetail];
        if (typeof suggested === "number") setTargetPageCount(clampPageCount(suggested));
      }
    } catch (e: any) {
      setResearchDigestError(e?.message || ui("리서치 분석에 실패했어.", "Research analysis failed."));
    } finally {
      setIsResearchAnalyzing(false);
    }
  };

  const handleAnalyzeStory = async () => {
    if (isStoryAnalyzing || scriptText.trim().length < 50) return;
    setIsStoryAnalyzing(true);
    setStoryDigestError(null);
    setStoryDigestWarnings([]);
    setStoryPageSuggestions(null);

    try {
      const result = await analyzeStoryScript({
        script_text: scriptText,
        story_input_type: storyInputType,
        genre: storyGenre || undefined,
        pacing: pacingPreference,
        age_rating: ageRating,
        publication_format: publicationFormat
      });
      setStoryDigestText(result.notes);
      setStoryDigestWarnings(result.warnings);
      setStoryPageSuggestions(result.page_suggestions);
    } catch (e: any) {
      setStoryDigestError(e?.message || ui("스토리 분석에 실패했어.", "Story analysis failed."));
    } finally {
      setIsStoryAnalyzing(false);
    }
  };

  const runPaperAnalysis = async (file: File) => {
    if (isPaperAnalyzing) return;
    setIsPaperAnalyzing(true);
    setPaperBriefError(null);
    setPaperBrief(null);

    try {
      const result = await analyzePaperPdf({
        file,
        audience_level: audienceLevel,
        detail_level: scriptDetail,
        publication_format: publicationFormat
      });
      setPaperBrief(result);
      setTopic(result.paper_title || "");
      if (pageCountMode === "auto") {
        const suggested = result.page_suggestions?.[scriptDetail];
        if (typeof suggested === "number") setTargetPageCount(clampPageCount(suggested));
      }
    } catch (e: any) {
      setPaperBriefError(e?.message || ui("논문 분석에 실패했어.", "Paper analysis failed."));
    } finally {
      setIsPaperAnalyzing(false);
    }
  };

  const runPaperUrlAnalysis = async () => {
    if (isPaperAnalyzing) return;
    const rawUrl = paperUrl.trim();
    if (!rawUrl) {
      setPaperBriefError(ui("논문 URL을 먼저 입력해줘.", "Enter a paper URL first."));
      return;
    }
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    try {
      new URL(url);
    } catch {
      setPaperBriefError(ui("URL 형식이 올바르지 않아.", "The URL format looks invalid."));
      return;
    }

    setIsPaperAnalyzing(true);
    setPaperBriefError(null);
    setPaperBrief(null);
    setPaperFile(null);
    setPaperUrl(url);

    try {
      const result = await analyzePaperUrl({
        url,
        audience_level: audienceLevel,
        detail_level: scriptDetail,
        publication_format: publicationFormat
      });
      setPaperBrief(result);
      setTopic(result.paper_title || "");
      if (pageCountMode === "auto") {
        const suggested = result.page_suggestions?.[scriptDetail];
        if (typeof suggested === "number") setTargetPageCount(clampPageCount(suggested));
      }
    } catch (e: any) {
      setPaperBriefError(e?.message || ui("논문 URL 조사에 실패했어.", "Paper URL research failed."));
    } finally {
      setIsPaperAnalyzing(false);
    }
  };

  const handlePaperFileChange = async (file: File | null) => {
    setPaperFile(file);
    if (file) setPaperUrl("");
    setPaperBrief(null);
    setPaperBriefError(null);
    if (!file) return;
    await runPaperAnalysis(file);
  };

  const handleGeneratePlan = async (styleOverride?: SeriesSpec["anchors"]["style"] | null) => {
    if (!hasApiKey) {
      setSystemError(ui("플랜/스크립트 생성에는 로컬 서버와 Codex 로그인이 필요해. `npm run dev`와 `npx @openai/codex login`을 확인해줘.", "Plan/script generation requires the local server and Codex login. Check `npm run dev` and `npx @openai/codex login`."));
      setStatus(AppStatus.CHARACTER_SELECT);
      return;
    }
    const effectiveStyle = styleOverride || finalStyle || {
      ...resolveCurrentStyle()
    };
    if (!effectiveStyle) return;
    if (creationType === "story") {
      if (scriptText.trim().length < 50) return;
    } else if (creationType === "paper") {
      if (!paperBrief) return;
    } else {
      if (!topic.trim()) return;
    }
    generationRunIdRef.current += 1;
    const runId = generationRunIdRef.current;
    try {
      setSystemError(null);
      setAutoGeneratePages(false);
      setRegenerateAllPages(false);
      setRegenerateCursor(1);
      setIsProcessingPageIndex(null);
      setPageResults([]);
      setPageErrors({});
      setWebtoonEpisodeResult(null);
      setIsBuildingWebtoonEpisode(false);
      setPageRenderedAt({});
      setPageRenderedImageSize({});
      setPageRenderedEngineKey({});
      setPageScriptEditedAt({});
      setPageStyleOverrides({});
      setPageStyleEditedAt({});
      setGlobalStyleEditedAt(0);
      setPageScriptEditorOpen(false);
      setPageScriptDraft(null);
      setPageEditActionOpen(false);
      setPageEditTargetIndex(null);
      setPageStyleEditorOpen(false);
      setPageStyleTargetIndex(null);
      setBusyPhase("planning");
      setStatus(AppStatus.PLANNING);
      const protagonists = cast.filter((c) => c.role === "protagonist");
      if (protagonists.length === 0) {
        setSystemError(ui("주연(주인공)을 최소 1명 추가해줘.", "Add at least 1 lead character."));
        setStatus(AppStatus.CHARACTER_SELECT);
        return;
      }

      const primary = protagonists[0];
      const primaryAppearance =
        String(primary.analyzed_appearance || primary.appearance || "").trim() || String(primary.name || "").trim() || "A friendly guide character";
      const primaryRefs = Array.isArray(primary.reference_images) ? primary.reference_images.filter(Boolean) : [];
      const supportingSummary = cast
        .filter((c) => c.role === "supporting")
        .map(buildCastSummaryLine)
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n");

      const isI2VSelected = isKlingI2VFormat(publicationFormat);
      let templatesForPlan: LayoutTemplate[];
      if (isI2VSelected) {
        const targetI2VTemplateId = I2V_TEMPLATE_BY_RATIO[i2vAspectRatio];
        const i2vTemplate =
          templates.find((t) => t.id === targetI2VTemplateId) ||
          templates.find((t) => t.panels.length === 1);
        templatesForPlan = i2vTemplate ? [i2vTemplate] : [];
      } else {
        templatesForPlan = getTemplatesForFormat(publicationFormat, templates);
        if (publicationFormat === "learning_comic" && layoutVariety !== "high") {
          templatesForPlan = templatesForPlan.filter((t) => t.panels.length === 4);
        }
        if (templatesForPlan.length === 0) {
          // Fallback for formats without dedicated templates yet
          templatesForPlan = templates.filter((t) => t.panels.length === 4);
        }
      }

      if (templatesForPlan.length === 0) {
        setSystemError(ui("레이아웃 템플릿을 찾을 수 없어. 새로고침 후 다시 시도해줘.", "Could not find layout templates. Refresh and try again."));
        setStatus(AppStatus.CHARACTER_SELECT);
        return;
      }

      let plan: SeriesPlan;
      if (creationType === "story") {
        plan = await generateStoryPlan({
          script_text: scriptText,
          story_input_type: storyInputType,
          genre: storyGenre || undefined,
          pacing: pacingPreference,
          age_rating: ageRating,
          detail_level: scriptDetail,
          language,
          delivery_style: resolveDeliveryStyleSpec({
            preset_id: deliveryStyleId,
            custom_instruction: deliveryCustomInstruction,
            audience_level: audienceLevel,
            comic_mode: "pure_cinematic"
          }),
          tone_mode: toneMode,
          tone_level: toneLevel,
          layout_variety: layoutVariety,
          image_size: imageSize,
          page_count: targetPageCount,
          publication_format: publicationFormat,
          manga_color_mode: mangaColorMode,
          i2v_aspect_ratio: i2vAspectRatio,
          story_anti_education_guard: storyAntiEducationGuardEnabled,
          character_consistency_mode: characterConsistencyMode,
          character_description: primaryAppearance,
          character_role: narrativeRole,
          character_refs: { main: primaryRefs[0] || "", pack: primaryRefs },
          product:
            productReferenceImages.length > 0
              ? { label: scriptText.slice(0, 30), reference_images: productReferenceImages.filter(Boolean) }
              : undefined,
          supporting_cast: supportingSummary || undefined,
          cast,
          style: effectiveStyle,
          templates: templatesForPlan,
          digest_notes: storyDigestText.trim() || undefined,
          gemini_reasoning_effort: geminiReasoningEffort,
        });
      } else if (creationType === "paper") {
        plan = await generatePaperPlan({
          paper_brief: paperBrief,
          detail_level: scriptDetail,
          language,
          audience_level: audienceLevel,
          layout_variety: layoutVariety,
          image_size: imageSize,
          page_count: targetPageCount,
          publication_format: publicationFormat,
          manga_color_mode: mangaColorMode,
          i2v_aspect_ratio: i2vAspectRatio,
          tone_mode: toneMode,
          tone_level: toneLevel,
          character_consistency_mode: characterConsistencyMode,
          character_description: primaryAppearance,
          character_role: narrativeRole,
          character_refs: { main: primaryRefs[0] || "", pack: primaryRefs },
          supporting_cast: supportingSummary || undefined,
          cast,
          style: effectiveStyle,
          templates: templatesForPlan,
          gemini_reasoning_effort: geminiReasoningEffort
        });
      } else {
        let effectivePageCount = targetPageCount;
        if (!researchDigestText.trim()) {
          setSystemError(ui("먼저 자료를 AI로 핵심 정리해줘.", "Summarize the material with AI first."));
          setStatus(AppStatus.TOPIC_INPUT);
          return;
        }
        const resolvedResearchParam = {
          mode: "auto_digest" as const,
          pack: {
            notes: researchDigestText.trim(),
            sources: researchDigestSources,
            page_suggestions: pageSuggestions || undefined
          }
        };
        if (pageCountMode === "auto") {
          const suggestions = "page_suggestions" in resolvedResearchParam.pack
            ? resolvedResearchParam.pack.page_suggestions || null
            : null;
          const suggested = suggestions?.[scriptDetail];
          if (typeof suggested === "number") {
            effectivePageCount = clampPageCount(suggested);
            setTargetPageCount(effectivePageCount);
            setPageSuggestions(suggestions);
          }
        }
        plan = await generatePlan({
          topic,
          question_type: questionType,
          comic_mode: comicMode,
          output_mode: toLegacyOutputMode(publicationFormat),
          publication_format: publicationFormat,
          manga_color_mode: mangaColorMode,
          i2v_aspect_ratio: i2vAspectRatio,
          tone_mode: toneMode,
          tone_level: toneLevel,
          intro_style: introStyle,
          detail_level: scriptDetail,
          language,
          audience_level: audienceLevel,
          character_consistency_mode: characterConsistencyMode,
          delivery_style: resolveDeliveryStyleSpec({
            preset_id: deliveryStyleId,
            custom_instruction: deliveryCustomInstruction,
            audience_level: audienceLevel,
            comic_mode: comicMode
          }),
          layout_variety: layoutVariety,
          image_size: imageSize,
          page_count: effectivePageCount,
          character_description: primaryAppearance,
          character_role: narrativeRole,
          character_refs: { main: primaryRefs[0] || "", pack: primaryRefs },
          product:
            productReferenceImages.length > 0
              ? { label: topic, reference_images: productReferenceImages.filter(Boolean) }
              : undefined,
          supporting_cast: supportingSummary || undefined,
          cast,
          style: effectiveStyle,
          templates: templatesForPlan,
          gemini_reasoning_effort: geminiReasoningEffort,
          research: resolvedResearchParam
        });
      }
      if (generationRunIdRef.current !== runId) return;
      setSeriesPlan(plan);
      setStatus(AppStatus.PLAN_REVIEW);
    } catch (e) {
      console.error(e);
      if (generationRunIdRef.current !== runId) return;
      setSystemError(toUserFacingError((e as any)?.message, ui("플랜 생성에 실패했어.", "Plan generation failed."), uiLanguage));
      setStatus(AppStatus.ERROR);
    }
  };

  const switchPlanLanguage = async (nextLanguage: Language) => {
    const currentPlanLanguage = seriesPlan?.series_spec?.series?.language;
    if (!seriesPlan) {
      setLanguage(nextLanguage);
      return;
    }
    if (currentPlanLanguage === nextLanguage) {
      setLanguage(nextLanguage);
      return;
    }
    setLanguage(nextLanguage);

    generationRunIdRef.current += 1;
    const runId = generationRunIdRef.current;

    setAutoGeneratePages(false);
    setRegenerateAllPages(false);
    setRegenerateCursor(1);
    setIsProcessingPageIndex(null);
    setPageResults([]);
    setPageErrors({});
    setWebtoonEpisodeResult(null);
    setIsBuildingWebtoonEpisode(false);
    setPageRenderedAt({});
    setPageRenderedImageSize({});
    setPageRenderedEngineKey({});
    setPageEditActionOpen(false);
    setPageEditTargetIndex(null);
    setPageStyleEditorOpen(false);
    setPageStyleTargetIndex(null);
    setSystemError(null);
    setBusyPhase("translating");
    setStatus(AppStatus.PLANNING);

    const returnStatus =
      status === AppStatus.READY_TO_GENERATE || status === AppStatus.GENERATING_PANELS
        ? AppStatus.READY_TO_GENERATE
        : AppStatus.PLAN_REVIEW;

    try {
      const translated = await translateSeriesPlan({
        series_spec: seriesPlan.series_spec,
        pages: seriesPlan.pages,
        to: nextLanguage
      });
      if (generationRunIdRef.current !== runId) return;
      setSeriesPlan((prev) => (prev ? { ...prev, series_spec: translated.series_spec, pages: translated.pages } : prev));
      setBusyPhase("planning");
      setStatus(returnStatus);
    } catch (e) {
      console.error(e);
      if (generationRunIdRef.current !== runId) return;
      setSystemError(toUserFacingError((e as any)?.message, ui("언어 변환에 실패했어.", "Language conversion failed."), uiLanguage));
      setStatus(AppStatus.ERROR);
    }
  };

  const openPageScriptEditor = (pageIndex: number) => {
    if (!seriesPlan) return;
    const page = seriesPlan.pages.find((p) => p.page.index === pageIndex) || seriesPlan.pages[pageIndex - 1];
    if (!page) return;
    setPageScriptDraft(deepClone(page));
    setPageScriptEditorOpen(true);
  };

  const closePageScriptEditor = () => {
    setPageScriptEditorOpen(false);
    setPageScriptDraft(null);
  };

  const openPageEditAction = (pageIndex: number) => {
    setPageEditTargetIndex(pageIndex);
    setPageEditActionOpen(true);
  };

  const closePageEditAction = () => {
    setPageEditActionOpen(false);
    setPageEditTargetIndex(null);
  };

  const openPageStyleEditor = (pageIndex: number) => {
    setPageStyleTargetIndex(pageIndex);
    setPageStyleEditorOpen(true);
  };

  const closePageStyleEditor = () => {
    setPageStyleEditorOpen(false);
    setPageStyleTargetIndex(null);
  };

  const clearPageStyleOverride = () => {
    const pageIndex = pageStyleTargetIndex;
    if (!pageIndex) return;
    setPageStyleOverrides((prev) => {
      const next = { ...prev };
      delete next[pageIndex];
      return next;
    });
    setPageStyleEditedAt((prev) => ({ ...prev, [pageIndex]: Date.now() }));
    closePageStyleEditor();
  };

  const savePageStyle = async (
    style: SeriesSpec["anchors"]["style"],
    scope: "page" | "all",
    opts: { redraw: boolean }
  ) => {
    if (!seriesPlan) return;
    const pageIndex = pageStyleTargetIndex;
    if (!pageIndex) return;
    const now = Date.now();

    if (scope === "page") {
      setPageStyleOverrides((prev) => ({ ...prev, [pageIndex]: style }));
      setPageStyleEditedAt((prev) => ({ ...prev, [pageIndex]: now }));
    } else {
      setSeriesPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          series_spec: {
            ...prev.series_spec,
            anchors: { ...prev.series_spec.anchors, style }
          }
        };
      });
      setFinalStyle(style);
      setGlobalStyleEditedAt(now);
      setPageStyleOverrides({});
      setPageStyleEditedAt({});
    }

    closePageStyleEditor();

    if (opts.redraw) {
      await generatePage(pageIndex, undefined, style);
    }
  };

  const persistPageScriptDraft = (draft: PageSpec) => {
    const pageIndex = draft.page.index;
    setSeriesPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: prev.pages.map((p) => (p.page.index === pageIndex ? draft : p))
      };
    });
    setPageScriptEditedAt((prev) => ({ ...prev, [pageIndex]: Date.now() }));
  };

  const savePageScript = () => {
    if (!pageScriptDraft) return;
    persistPageScriptDraft(pageScriptDraft);
    closePageScriptEditor();
  };

  const saveAndRedrawPageScript = async () => {
    if (!pageScriptDraft) return;
    const draft = pageScriptDraft;
    persistPageScriptDraft(draft);
    closePageScriptEditor();
    await generatePage(draft.page.index, draft);
  };

  const generatePage = async (
    pageIndex: number,
    overridePage?: PageSpec,
    overrideStyle?: SeriesSpec["anchors"]["style"]
  ): Promise<boolean> => {
    if (!seriesPlan) return false;
    if (isGeneratingPageRef.current) return false;
    const runId = generationRunIdRef.current;
    const page = overridePage || seriesPlan.pages.find((p) => p.page.index === pageIndex);
    if (!page) return false;
    const styleForThisCall = overrideStyle || pageStyleOverrides[pageIndex] || null;
    let resolvedSeriesSpec: SeriesSpec = styleForThisCall
      ? {
        ...seriesPlan.series_spec,
        anchors: { ...seriesPlan.series_spec.anchors, style: styleForThisCall }
      }
      : seriesPlan.series_spec;

    const styleConsistencyImage = useCrossPageStyleConsistency && !styleForThisCall
      ? pageResults
        .filter((r) => r.page_index !== pageIndex && r.composed_image_url?.startsWith("data:"))
        .sort((a, b) => {
          const diffA = Math.abs(a.page_index - pageIndex);
          const diffB = Math.abs(b.page_index - pageIndex);
          if (diffA !== diffB) return diffA - diffB;
          return a.page_index - b.page_index;
        })[0]?.composed_image_url || null
      : null;

    isGeneratingPageRef.current = true;
    setStatus(AppStatus.GENERATING_PANELS);
    setIsProcessingPageIndex(pageIndex);
    setPageErrors((prev) => {
      if (!prev[pageIndex]) return prev;
      const next = { ...prev };
      delete next[pageIndex];
      return next;
    });

    try {
      const compressedStyleConsistencyImage = styleConsistencyImage
        ? await compressReferenceDataUrl(styleConsistencyImage)
        : null;
      const pageImageUrl = await generateFullPageImage(resolvedSeriesSpec, page, imageSize, comicMode, {
        styleConsistencyImage: compressedStyleConsistencyImage,
        imageProvider,
        codexImageQuality
      });
      if (generationRunIdRef.current !== runId) return false;
      setPageResults((prev) => upsertGenerationResult(prev, {
        page_index: pageIndex,
        composed_image_url: pageImageUrl
      }));
      setPageRenderedAt((prev) => ({ ...prev, [pageIndex]: Date.now() }));
      setPageRenderedImageSize((prev) => ({ ...prev, [pageIndex]: imageSize }));
      setPageRenderedEngineKey((prev) => ({
        ...prev,
        [pageIndex]: buildImageEngineKey(imageProvider, codexImageQuality)
      }));
      setSystemError(null);
      setStatus(AppStatus.READY_TO_GENERATE);
      return true;
    } catch (e) {
      console.error(e);
      if (generationRunIdRef.current !== runId) return false;
      const message = toUserFacingError(
        (e as any)?.message,
        isKlingI2VFormat(publicationFormat)
          ? ui("프레임 생성에 실패했어.", "Frame generation failed.")
          : ui("페이지 생성에 실패했어.", "Page generation failed."),
        uiLanguage
      );
      setPageErrors((prev) => ({ ...prev, [pageIndex]: message }));
      setSystemError(message);
      setStatus(AppStatus.READY_TO_GENERATE);
      return false;
    } finally {
      isGeneratingPageRef.current = false;
      if (generationRunIdRef.current === runId) setIsProcessingPageIndex(null);
    }
  };

  useEffect(() => {
    if (!autoGeneratePages) return;
    if (regenerateAllPages) return;
    if (!seriesPlan) return;
    if (!(status === AppStatus.READY_TO_GENERATE || status === AppStatus.GENERATING_PANELS)) return;
    if (isProcessingPageIndex !== null) return;
    if (isGeneratingPageRef.current) return;

    const nextPage = seriesPlan.pages.find(p => !pageResults.some(r => r.page_index === p.page.index));
    if (!nextPage) {
      setAutoGeneratePages(false);
      return;
    }

    void (async () => {
      const ok = await generatePage(nextPage.page.index);
      if (!ok) setAutoGeneratePages(false);
    })();
  }, [autoGeneratePages, imageProvider, imageSize, isProcessingPageIndex, codexImageQuality, pageResults, regenerateAllPages, seriesPlan, status]);

  useEffect(() => {
    if (!regenerateAllPages) return;
    if (autoGeneratePages) return;
    if (!seriesPlan) return;
    if (!(status === AppStatus.READY_TO_GENERATE || status === AppStatus.GENERATING_PANELS)) return;
    if (isProcessingPageIndex !== null) return;
    if (isGeneratingPageRef.current) return;

    const total = seriesPlan.pages.length;
    if (regenerateCursor < 1 || regenerateCursor > total) {
      setRegenerateAllPages(false);
      setRegenerateCursor(1);
      return;
    }

    void (async () => {
      const ok = await generatePage(regenerateCursor);
      if (!ok) {
        setRegenerateAllPages(false);
        setRegenerateCursor(1);
        return;
      }
      setRegenerateCursor((prev) => prev + 1);
    })();
  }, [autoGeneratePages, imageProvider, imageSize, isProcessingPageIndex, codexImageQuality, regenerateAllPages, regenerateCursor, seriesPlan, status]);

  useEffect(() => {
    let cancelled = false;

    if (!seriesPlan || !isWebtoon(publicationFormat) || pageResults.length === 0) {
      setWebtoonEpisodeResult(null);
      setIsBuildingWebtoonEpisode(false);
      return () => {
        cancelled = true;
      };
    }

    setIsBuildingWebtoonEpisode(true);
    void (async () => {
      try {
        const nextResult = await composeWebtoonEpisodeSegments(seriesPlan.pages, pageResults, imageSize);
        if (!cancelled) {
          setWebtoonEpisodeResult(nextResult);
        }
      } catch (e) {
        console.error("Webtoon episode compose failed", e);
        if (!cancelled) {
          setSystemError(ui("웹툰 세로 리더를 조립하지 못했어. 페이지 이미지는 그대로 유지돼.", "Could not assemble the vertical webtoon reader. Page images are preserved."));
          setWebtoonEpisodeResult(null);
        }
      } finally {
        if (!cancelled) setIsBuildingWebtoonEpisode(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageSize, pageResults, publicationFormat, seriesPlan]);

  const downloadImage = (url: string, index: number) => {
    const fmtConfig = getFormatConfig(publicationFormat);
    const unit = fmtConfig.unitLabel.toLowerCase();
    const link = document.createElement('a');
    link.href = url;
    link.download = `toon_for_codex_${unit}_${index}.png`;
    link.click();
  };

  const downloadReferenceImage = (url: string, character: CharacterSpec, index: number) => {
    const safeName = String(character.name || (character.role === "protagonist" ? "protagonist" : "supporting"))
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 40) || "character";
    const link = document.createElement("a");
    link.href = url;
    link.download = `toon_for_codex_${safeName}_ref_${index + 1}.png`;
    link.click();
  };

  const downloadAllPagesAsZip = async () => {
    if (!seriesPlan) return;
    if (isDownloadingZip) return;

    const fmtConfig = getFormatConfig(publicationFormat);
    const images = seriesPlan.pages
      .map((p) => {
        const res = pageResults.find((r) => r.page_index === p.page.index);
        if (!res) return null;
        return {
          name: `${fmtConfig.unitLabel}_${p.page.index}_${p.page.chapter_title}`,
          url: res.composed_image_url
        };
      })
      .filter((v): v is { name: string; url: string } => Boolean(v));

    if (images.length === 0) {
      setSystemError(ui(`다운로드할 ${fmtConfig.unitLabelKo}이(가) 없어. 먼저 생성해줘.`, `No ${fmtConfig.unitLabel.toLowerCase()}s to download. Generate them first.`));
      return;
    }

    setSystemError(null);
    setIsDownloadingZip(true);
    try {
      const title = seriesPlan.series_spec.series.title || "Toon for Codex";
      await downloadAsZip(images, `${title}_${fmtConfig.id}_${images.length}${fmtConfig.unitLabel.toLowerCase()}s`);
    } catch (e) {
      console.error(e);
      setSystemError(toUserFacingError((e as any)?.message, ui("전체 다운로드에 실패했어.", "Full download failed."), uiLanguage));
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const exportCodexHandoffZip = () => {
    if (!seriesPlan) return;
    if (isExportingCodexHandoff) return;

    setSystemError(null);
    setIsExportingCodexHandoff(true);
    try {
      const files = buildCodexHandoffFiles({
        seriesPlan,
        imageSize,
        comicMode,
        codexImageQuality,
        codexImageModel: DEFAULT_CODEX_IMAGE_MODEL,
        pageStyleOverrides,
        pageResults,
        useCrossPageStyleConsistency
      });
      const title = seriesPlan.series_spec.series.title || "Toon for Codex";
      downloadFilesAsZip(files, `${title}_codex_handoff_${seriesPlan.pages.length}pages`);
    } catch (e) {
      console.error(e);
      setSystemError(toUserFacingError((e as any)?.message, ui("Codex 제작 묶음 내보내기에 실패했어.", "Codex handoff export failed."), uiLanguage));
    } finally {
      setIsExportingCodexHandoff(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setSystemError(null);
    } catch (e) {
      console.warn("Clipboard copy failed", e);
      setSystemError(ui("클립보드 복사에 실패했어. 브라우저 권한을 확인해줘.", "Clipboard copy failed. Check browser permissions."));
    }
  };

  const castProtagonists = cast.filter((c) => c.role === "protagonist");
  const castSupporting = cast.filter((c) => c.role === "supporting");
  const isPaperSelected = creationType === "paper";
  const isEduCinematicSelected = isEduCinematicMode(comicMode);
  const isPureCinematicSelected = isPureCinematicMode(comicMode);
  const isAnyCinematicSelected = isAnyCinematicMode(comicMode);
  const isI2VSelected = isKlingI2VFormat(publicationFormat);
  const isLearningComicSelected = isLearningComic(publicationFormat);
  const isWebtoonSelected = isWebtoon(publicationFormat);
  const currentFormatConfig = getFormatConfig(publicationFormat);
  const unitLabel = uiLanguage === "ko" ? currentFormatConfig.unitLabelKo : currentFormatConfig.unitLabel;
  const previewAspectClass = getPreviewAspectClass(publicationFormat, i2vAspectRatio);
  const showNarrativeText = outputReaderMode === "visual_plus_script";
  const currentImageEngineKey = buildImageEngineKey(imageProvider, codexImageQuality);
  const currentImageEngineLabel = getImageEngineLabel(imageProvider, codexImageQuality);
  const imageSizeSummary = imageSize === "1K"
    ? ui("1K 빠름", "1K fast")
    : imageSize === "2K"
      ? ui("2K 선명", "2K sharp")
      : ui("4K 고해상도", "4K high-res");
  const imageQualitySummary = codexImageQuality === "low"
    ? ui("품질 빠르게", "quick quality")
    : codexImageQuality === "high"
      ? ui("품질 높게", "high quality")
      : ui("품질 보통", "normal quality");
  const readerModeSummary = outputReaderMode === "visual_plus_script"
    ? ui("이미지+장면 텍스트", "image + scene text")
    : ui("이미지만 보기", "images only");
  const generatedProgressLabel = seriesPlan
    ? `${pageResults.length}/${seriesPlan.pages.length} ${isI2VSelected ? ui("프레임", "frames") : ui("페이지", "pages")}`
    : "";
  const pageErrorEntries = Object.entries(pageErrors)
    .map(([pageIndex, message]) => ({ pageIndex: Number(pageIndex), message }))
    .filter((entry) => Number.isFinite(entry.pageIndex) && Boolean(entry.message))
    .sort((a, b) => a.pageIndex - b.pageIndex);
  const failedUnitCount = pageErrorEntries.length;
  const pageResultsMap = new Map<number, GenerationResult>(pageResults.map((result) => [result.page_index, result]));
  const rawWebtoonFallbackSegments = (seriesPlan?.pages || [])
    .filter((page) => pageResultsMap.has(page.page.index))
    .map((page) => ({
      pageIndex: page.page.index,
      url: pageResultsMap.get(page.page.index)?.composed_image_url || "",
    }))
    .filter((segment) => Boolean(segment.url));
  const nextPendingPage = seriesPlan?.pages.find((page) => !pageResultsMap.has(page.page.index)) || null;
  const generatedPageCount = pageResults.length;
  const isTopicRequiredMissing = creationType === "educational" && !topic.trim();
  const canProceedMissionSetup =
    creationType === "story"
      ? scriptText.trim().length >= 50 && !isStoryAnalyzing
      : creationType === "paper"
        ? Boolean(paperBrief) && !isPaperAnalyzing
        : (
          Boolean(topic.trim()) &&
          !isResearchAnalyzing &&
          Boolean(researchDigestText.trim())
        );
  const canProceedCharacterSetup =
    castProtagonists.length > 0 &&
    castProtagonists.some((c) => Boolean(String(c.appearance || "").trim() || String(c.name || "").trim() || (c.reference_images || []).length > 0));
  const canGeneratePlan =
    canProceedMissionSetup &&
    canProceedCharacterSetup &&
    stylePresets.length > 0 &&
    hasApiKey;
  const selectedStylePresetForDisplay = stylePresets.find((p) => p.id === selectedPresetId);
  const paperTrackLabel =
    paperBrief?.paper_mode_track === "methodology_focus" ? "방법론 중심" : "대중형 요약";

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="bg-white border-4 border-black p-8 comic-shadow max-w-md w-full">
          <Key className="w-16 h-16 mx-auto mb-4 text-blue-600" />
          <h1 className="text-2xl font-black mb-4 uppercase">{ui("로컬 스튜디오 오프라인", "Local Studio Offline")}</h1>
          <p className="text-sm font-bold text-slate-500 mb-6">
            {ui("로컬 서버가 필요해.", "Local server is required.")} <span className="font-black">npm run dev</span>{ui("로 실행하고, Codex 로그인이 안 되어 있으면 터미널에서", " should be running. If Codex is not logged in, run")} <span className="font-black">npx @openai/codex login</span>{ui("을 먼저 실행해줘.", " first.")}
          </p>
        </div>
      </div>
    );
  }

  const buildDevPromptSettingsSummary = (plan: SeriesPlan | null): string => {
    if (!plan) return "";
    const detailLevelNumeric = Number(plan.plan_meta?.detail_level);
    const detailLabel = detailLevelNumeric === 0 ? "brief" : detailLevelNumeric === 2 ? "detailed" : "normal";
    const deliveryLabel =
      (DELIVERY_STYLE_PRESETS.find((p) => p.id === deliveryStyleId) || DELIVERY_STYLE_PRESETS[0]).label;
    const createdAt =
      plan.debug?.created_at ? new Date(plan.debug.created_at).toLocaleString() : "";

    const lines: string[] = [];
    lines.push(`created_at: ${createdAt || "(unknown)"}`);
    lines.push(`topic: ${topic || "(empty)"}`);
    lines.push(`question_type: ${questionType}`);
    lines.push(`comic_mode: ${comicMode} (${getComicModeDisplayLabel(comicMode)})`);
    lines.push(`publication_format: ${publicationFormat}`);
    lines.push(`i2v_aspect_ratio: ${i2vAspectRatio}`);
    lines.push(`tone_mode: ${toneMode}${toneMode === "gag" ? `(${toneLevel})` : ""}`);
    lines.push(`intro_style: ${introStyle}`);
    lines.push(`audience_level: ${audienceLevel}`);
    lines.push(`research_mode: ${researchMode}`);
    lines.push(`planner_model: ${GEMINI_PLANNER_MODEL}`);
    lines.push(`planner_reasoning_effort: ${geminiReasoningEffort}`);
    lines.push(`narrative_role: ${narrativeRole}`);
    lines.push(`detail_level: ${detailLabel} (${Number.isFinite(detailLevelNumeric) ? detailLevelNumeric : "?"})`);
    lines.push(`language: ${plan.series_spec.series.language}`);
    lines.push(`page_count: ${plan.series_spec.series.page_count}`);
    lines.push(`layout_variety: ${plan.series_spec.constraints.layout_variety}`);
    lines.push(`image_size: ${plan.series_spec.constraints.image_size}`);
    lines.push(`image_model: ${currentImageEngineLabel}`);
    lines.push(`character_consistency_mode: ${plan.series_spec.constraints.character_consistency_mode || "loose"}`);
    lines.push(`cross_page_style_consistency: ${useCrossPageStyleConsistency ? "on" : "off"}`);
    lines.push(`style_preset: ${plan.series_spec.anchors.style.preset_label} (${plan.series_spec.anchors.style.preset_id})`);
    lines.push(`delivery_style: ${deliveryLabel}`);
    return lines.join("\n");
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-gray-900 p-4 md:p-6 pb-24 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8 md:mb-12 border-b-4 border-black pb-6">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 border-2 border-black rotate-3">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl md:text-4xl font-black italic tracking-tighter uppercase">Toon <span className="text-blue-600">for Codex</span></h1>
          </div>
          <div className="flex items-center gap-2 self-end md:self-auto">
            <div className="flex overflow-hidden border-2 border-black bg-white">
              <button
                type="button"
                onClick={() => setUiLanguage("ko")}
                className={`px-3 py-2 text-[10px] md:text-xs font-black uppercase border-r-2 border-black ${uiLanguage === "ko" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                aria-pressed={uiLanguage === "ko"}
              >
                한국어
              </button>
              <button
                type="button"
                onClick={() => setUiLanguage("en")}
                className={`px-3 py-2 text-[10px] md:text-xs font-black uppercase ${uiLanguage === "en" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                aria-pressed={uiLanguage === "en"}
              >
                EN
              </button>
            </div>
            <button onClick={resetApp} className="border-2 border-black px-3 py-2 md:px-4 bg-white font-black text-[10px] md:text-xs flex items-center gap-2 hover:bg-slate-100"><RotateCcw size={14} /> {ui("새로 시작", "New")}</button>
          </div>
        </header>

        <div className="mb-8 bg-white border-4 border-black p-4 md:p-5 comic-shadow">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase text-blue-700 flex items-center gap-2">
                <Bookmark size={14} /> {ui("프로젝트 보관함", "Project Library")}
              </p>
              {activeProjectId ? (
                <p className="text-[10px] font-black text-slate-700 mt-2">
                  {ui("현재 연결된 프로젝트", "Current project")}: {savedProjects.find((p) => p.id === activeProjectId)?.label || ui("(알 수 없음)", "(unknown)")}
                </p>
              ) : (
                <p className="text-[10px] font-bold text-slate-400 mt-2">{ui("현재는 새 프로젝트 상태야.", "This is a new project.")}</p>
              )}
            </div>
            <div className="w-full md:w-auto">
              <div className="grid grid-cols-1 md:grid-cols-[360px_auto_auto_auto] gap-2">
                <select
                  value={selectedSavedProjectId}
                  onChange={(e) => setSelectedSavedProjectId(e.target.value)}
                  className="w-full border-2 border-black px-3 py-2 font-black outline-none focus:bg-white text-[10px] md:text-xs bg-white"
                >
                  <option value="">
                    {savedProjects.length > 0 ? ui("(저장된 프로젝트 선택)", "(Select saved project)") : ui("(저장된 프로젝트 없음)", "(No saved projects)")}
                  </option>
                  {savedProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {new Date(p.updated_at).toLocaleString()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => loadSavedProject(selectedSavedProjectId)}
                  disabled={!selectedSavedProjectId}
                  className="border-2 border-black bg-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  title={ui("저장한 프로젝트 불러오기", "Load saved project")}
                >
                  <FolderOpen size={14} /> {ui("불러오기", "Load")}
                </button>
                <button
                  type="button"
                  onClick={promptSaveProject}
                  disabled={!seriesPlan}
                  className="bg-black text-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  title={ui("현재 프로젝트 즉시 저장", "Save current project")}
                >
                  <Save size={14} /> {ui("저장", "Save")}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSavedProject(selectedSavedProjectId)}
                  disabled={!selectedSavedProjectId}
                  className="border-2 border-black bg-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  title={ui("선택된 프로젝트 삭제", "Delete selected project")}
                >
                  <Trash2 size={14} /> {ui("삭제", "Delete")}
                </button>
              </div>
            </div>
          </div>
        </div>

        <PageScriptEditorModal
          open={pageScriptEditorOpen}
          page={pageScriptDraft}
          uiLanguage={uiLanguage}
          isBusy={status === AppStatus.GENERATING_PANELS}
          onClose={closePageScriptEditor}
          onChange={(next) => setPageScriptDraft(next)}
          onSave={savePageScript}
          onSaveAndRedraw={
            status === AppStatus.READY_TO_GENERATE || status === AppStatus.GENERATING_PANELS
              ? saveAndRedrawPageScript
              : undefined
          }
        />

        <PageEditActionModal
          open={pageEditActionOpen}
          pageIndex={pageEditTargetIndex}
          uiLanguage={uiLanguage}
          onClose={closePageEditAction}
          onEditScript={() => {
            const idx = pageEditTargetIndex;
            closePageEditAction();
            if (idx) openPageScriptEditor(idx);
          }}
          onEditStyle={() => {
            const idx = pageEditTargetIndex;
            closePageEditAction();
            if (idx) openPageStyleEditor(idx);
          }}
        />

        <PageStyleEditorModal
          open={pageStyleEditorOpen}
          pageIndex={pageStyleTargetIndex}
          uiLanguage={uiLanguage}
          presets={stylePresets}
          initialStyle={
            pageStyleTargetIndex && seriesPlan
              ? pageStyleOverrides[pageStyleTargetIndex] || seriesPlan.series_spec.anchors.style
              : null
          }
          hasPageOverride={Boolean(pageStyleTargetIndex && pageStyleOverrides[pageStyleTargetIndex])}
          isBusy={status === AppStatus.GENERATING_PANELS}
          onClose={closePageStyleEditor}
          onClearPageOverride={
            pageStyleTargetIndex && pageStyleOverrides[pageStyleTargetIndex] ? clearPageStyleOverride : undefined
          }
          onSave={savePageStyle}
        />

        <DevPromptCheckModal
          open={devPromptCheckOpen}
          plan={seriesPlan}
          settingsSummary={buildDevPromptSettingsSummary(seriesPlan)}
          uiLanguage={uiLanguage}
          onClose={() => setDevPromptCheckOpen(false)}
        />

        {status === AppStatus.CHARACTER_SELECT && (
          <div className="bg-white border-4 border-black p-6 md:p-10 comic-shadow animate-fade-in">
            <div className="mb-3">
              <PreviousStepButton />
            </div>
            <h2 className="text-2xl md:text-3xl font-black mb-6 md:mb-8 border-l-8 border-blue-600 pl-4 uppercase">{ui("03. 캐릭터 설정", "03. Setup Character")}</h2>
            <div className="mb-8 border-2 border-blue-600 bg-blue-50 px-4 py-3 text-[10px] md:text-xs font-black text-blue-900 uppercase flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <span>{ui("선택된 그림체", "Selected Style")}</span>
              <span>{selectedStylePresetForDisplay?.label || selectedPresetId}</span>
            </div>

            <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
              <p className="text-sm font-black text-gray-700 uppercase mb-4 flex items-center gap-2">
                <UserCheck size={18} className="text-blue-600" /> {ui("캐릭터 만드는 방법", "Character Setup Method")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setCharacterInputMode("suggest")}
                  className={`flex items-start gap-4 p-4 border-4 transition-all ${characterInputMode === "suggest" ? "border-blue-600 bg-blue-50" : "border-black bg-white hover:bg-gray-50"}`}
                >
                  <div className="bg-blue-600 text-white p-2 rounded-lg"><Wand2 size={20} /></div>
                  <div className="text-left">
                    <p className="font-black text-sm uppercase">{ui("캐릭터 제안 받기", "Suggest Characters")}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500 leading-relaxed">
                      {ui("자료에서 실제 등장인물 후보를 먼저 뽑아.", "Draft character candidates from your material first.")}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCharacterInputMode("manual")}
                  className={`flex items-start gap-4 p-4 border-4 transition-all ${characterInputMode === "manual" ? "border-blue-600 bg-blue-50" : "border-black bg-white hover:bg-gray-50"}`}
                >
                  <div className="bg-black text-white p-2 rounded-lg"><User size={20} /></div>
                  <div className="text-left">
                    <p className="font-black text-sm uppercase">{ui("직접 캐릭터 채우기", "Fill Characters Manually")}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500 leading-relaxed">
                      {ui("이름을 빠르게 넣거나 아래 카드에서 직접 작성해.", "Add names quickly or fill the cards below.")}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {characterInputMode === "suggest" && (
            <div className="mb-8 p-6 bg-yellow-50 border-2 border-black">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-black text-gray-800 uppercase mb-2 flex items-center gap-2">
                    <Wand2 size={18} className="text-yellow-600" /> {ui("자료에서 캐릭터 제안", "Suggest Characters from Material")}
                  </p>
                  <p className="text-[10px] md:text-xs font-bold text-slate-600 leading-relaxed">
                    {ui("원문 안의 행동, 관계, 호칭 단서로만 주연과 반복 출연자를 채워.", "Uses only source cues such as actions, relationships, and titles.")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void applyContentCastSuggestions()}
                  disabled={isSuggestingCastFromContent || isProcessing}
                  className="bg-black text-white px-5 py-3 font-black flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSuggestingCastFromContent ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                  {isSuggestingCastFromContent ? ui("제안 중", "Suggesting") : ui("AI 제안 받기", "Get AI Suggestions")}
                </button>
              </div>
              {castSuggestionNotice && (
                <div
                  className={`mt-5 border-2 p-3 text-[10px] md:text-xs font-bold whitespace-pre-wrap ${
                    castSuggestionNotice.kind === "error"
                      ? "border-red-500 bg-red-50 text-red-900"
                      : castSuggestionNotice.kind === "success"
                        ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                        : "border-yellow-600 bg-white text-slate-800"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {castSuggestionNotice.kind === "error" ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : castSuggestionNotice.kind === "success" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin" />}
                    <div className="min-w-0">
                      <p className="font-black">{castSuggestionNotice.message}</p>
                      {castSuggestionNotice.detail && (
                        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed">{castSuggestionNotice.detail}</pre>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}

            <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-slate-50 border-2 border-black">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
                  <p className="text-sm font-black text-gray-700 uppercase flex items-center gap-2"><UserCheck size={18} className="text-blue-600" /> {ui("주인공 역할", "Protagonist Role")}</p>
                  <span className="w-fit border-2 border-blue-600 bg-blue-50 px-3 py-1 text-[10px] font-black text-blue-700 uppercase">
                    {ui("현재 모드 기본값", "Mode Default")}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={() => setNarrativeRole("narrator")}
                    className={`flex items-start gap-4 p-4 border-4 transition-all ${narrativeRole === "narrator" ? "border-blue-600 bg-blue-50" : "border-black bg-white hover:bg-gray-50"}`}
                  >
                    <div className="bg-blue-600 text-white p-2 rounded-lg"><MessageSquareText size={20} /></div>
                    <div className="text-left">
                      <p className="font-black text-sm uppercase">{ui("설명하는 가이드", "Guide / Narrator")}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNarrativeRole("actor")}
                    className={`flex items-start gap-4 p-4 border-4 transition-all ${narrativeRole === "actor" ? "border-blue-600 bg-blue-50" : "border-black bg-white hover:bg-gray-50"}`}
                  >
                    <div className="bg-black text-white p-2 rounded-lg"><User size={20} /></div>
                    <div className="text-left">
                      <p className="font-black text-sm uppercase">{ui("직접 연기하는 배우", "Actor / Performer")}</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-2 border-black">
                <p className="text-sm font-black text-gray-700 uppercase mb-4 flex items-center gap-2">
                  <Layers size={18} className="text-blue-600" /> {ui("캐릭터 일관성", "Character Consistency")}
                </p>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={() => setCharacterConsistencyMode("loose")}
                    className={`flex items-start gap-4 p-4 border-4 transition-all ${characterConsistencyMode === "loose" ? "border-blue-600 bg-blue-50" : "border-black bg-white hover:bg-gray-50"}`}
                  >
                    <div className="bg-white border-2 border-black p-2 rounded-lg">
                      <p className="text-[10px] font-black uppercase">LOOSE</p>
                    </div>
                    <div className="text-left">
                      <p className="font-black text-sm uppercase">{ui("느슨", "Loose")}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCharacterConsistencyMode("strict")}
                    className={`flex items-start gap-4 p-4 border-4 transition-all ${characterConsistencyMode === "strict" ? "border-blue-600 bg-blue-50" : "border-black bg-white hover:bg-gray-50"}`}
                  >
                    <div className="bg-black text-white p-2 rounded-lg">
                      <p className="text-[10px] font-black uppercase">STRICT</p>
                    </div>
                    <div className="text-left">
                      <p className="font-black text-sm uppercase">{ui("엄격", "Strict")}</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
              <div className="bg-white border-4 border-black p-6 md:p-8">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-black text-slate-700 uppercase">{ui("주연(최대 2명)", "Lead Characters (Max 2)")}</p>
                    <p className="mt-2 text-[10px] md:text-xs font-bold text-slate-500 leading-relaxed">
                      {ui("주인공 1명만 있어도 다음 단계로 갈 수 있어.", "You can continue with just 1 lead character.")}
                    </p>
                  </div>
                  <div className="w-full md:w-[420px]">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                      <select
                        value={selectedCastPresetId}
                        onChange={(e) => setSelectedCastPresetId(e.target.value)}
                        className="w-full border-2 border-black px-3 py-2 font-black outline-none focus:bg-white text-[10px] md:text-xs bg-white"
                      >
                        <option value="">
                          {castPresets.length > 0 ? ui("(프리셋 선택)", "(Select preset)") : ui("(저장된 프리셋 없음)", "(No saved presets)")}
                        </option>
                        {castPresets
                          .slice()
                          .sort((a, b) => b.updated_at - a.updated_at)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addCastMember("protagonist")}
                        disabled={castProtagonists.length >= 2}
                        className="bg-black text-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus size={14} /> {ui("추가", "Add")}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => applyCastPresetToSection(selectedCastPresetId, "protagonist")}
                        disabled={!selectedCastPresetId}
                        className="border-2 border-black bg-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        title={ui("선택된 프리셋의 주연만 적용", "Apply only lead characters from selected preset")}
                      >
                        <FolderOpen size={14} /> {ui("프리셋 불러오기", "Load Preset")}
                      </button>
                      <button
                        type="button"
                        onClick={() => applyCastPreset(selectedCastPresetId)}
                        disabled={!selectedCastPresetId}
                        className="bg-black text-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        title={ui("선택된 프리셋을 주연+보조 전체에 적용", "Apply selected preset to lead and supporting cast")}
                      >
                        <FolderOpen size={14} /> {ui("전체 불러오기", "Load All")}
                      </button>
                      <button
                        type="button"
                        onClick={promptSaveCastPreset}
                        className="border-2 border-black bg-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-[10px] md:text-xs"
                        title={ui("현재 캐스트를 프리셋으로 저장", "Save current cast as preset")}
                      >
                        <Save size={14} /> {ui("프리셋 저장", "Save Preset")}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCastPreset(selectedCastPresetId)}
                        disabled={!selectedCastPresetId}
                        className="border-2 border-black bg-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        title={ui("선택된 프리셋 삭제", "Delete selected preset")}
                      >
                        <Trash2 size={14} /> {ui("삭제", "Delete")}
                      </button>
                    </div>
                  </div>
                </div>

                {castProtagonists.map((c) => (
                  <div key={c.id} className="mb-6 bg-slate-50 border-4 border-black p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-black text-[10px] uppercase text-slate-700">{ui("주연", "Protagonist")}</p>
                      <button
                        type="button"
                        onClick={() => removeCastMember(c.id)}
                        className="border-2 border-black bg-white px-2 py-1 font-black hover:bg-slate-100 text-[10px] flex items-center gap-1"
                      >
                        <Trash2 size={14} /> {ui("삭제", "Remove")}
                      </button>
                    </div>

                    <input
                      type="text"
                      value={c.name}
                      onChange={(e) => updateCastMember(c.id, { name: e.target.value })}
                      placeholder={ui("이름/호칭 (예: 세종대왕)", "Name/title (e.g. King Sejong)")}
                      className="w-full border-2 border-black p-3 font-bold mb-3 outline-none focus:bg-white text-sm"
                    />
                    <textarea
                      value={c.appearance}
                      onChange={(e) => updateCastMember(c.id, { appearance: e.target.value })}
                      placeholder={ui("외형/복장 (예: 단정한 한복, 근엄한 표정, 왕관)", "Appearance/outfit (e.g. neat hanbok, stern face, crown)")}
                      className="w-full border-2 border-black p-3 font-bold mb-3 outline-none focus:bg-white text-sm min-h-[76px]"
                    />
                    <textarea
                      value={c.persona || ""}
                      onChange={(e) => updateCastMember(c.id, { persona: e.target.value })}
                      placeholder={ui('페르소나/관계/직업 (예: "장영실의 후원자")', 'Persona/relationship/job (e.g. "Jang Yeong-sil’s sponsor")')}
                      className="w-full border-2 border-black p-3 font-bold mb-3 outline-none focus:bg-white text-sm min-h-[76px]"
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                      <input
                        type="text"
                        value={c.catchphrase || ""}
                        onChange={(e) => updateCastMember(c.id, { catchphrase: e.target.value })}
                        placeholder={ui('말버릇(선택) (예: "자, 집중!")', 'Catchphrase (optional)')}
                        className="w-full border-2 border-black p-3 font-bold outline-none focus:bg-white text-sm"
                      />
                      <select
                        value={(c.catchphrase_frequency || "rare") as CatchphraseFrequency}
                        onChange={(e) => updateCastMember(c.id, { catchphrase_frequency: e.target.value as CatchphraseFrequency })}
                        className="w-full border-2 border-black p-3 font-black outline-none focus:bg-white text-sm"
                      >
                        <option value="rare">{ui("드물게", "Rarely")}</option>
                        <option value="sometimes">{ui("가끔", "Sometimes")}</option>
                        <option value="often">{ui("자주", "Often")}</option>
                      </select>
                    </div>

	                    {renderCharacterReferenceControls(c, {
	                      inputId: `cast-img-${c.id}`,
	                      displayName: String(c.name || "").trim(),
	                      altFallback: "protagonist",
	                      panelClassName: "bg-white border-2 border-black p-3",
	                      titleClassName: "text-[10px] font-black uppercase text-slate-600",
	                      countClassName: "text-[10px] font-bold text-slate-500"
	                    })}
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border-4 border-blue-200 p-6 md:p-8">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <p className="text-xs font-black text-blue-600 uppercase">{ui("보조 출연자(반복 등장)", "Supporting Cast")}</p>
                  <div className="w-full md:w-[320px]">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                      <select
                        value={selectedCastPresetId}
                        onChange={(e) => setSelectedCastPresetId(e.target.value)}
                        className="w-full border-2 border-black px-3 py-2 font-black outline-none focus:bg-white text-[10px] md:text-xs bg-white"
                      >
                        <option value="">
                          {castPresets.length > 0 ? ui("(프리셋 선택)", "(Select preset)") : ui("(저장된 프리셋 없음)", "(No saved presets)")}
                        </option>
                        {castPresets
                          .slice()
                          .sort((a, b) => b.updated_at - a.updated_at)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addCastMember("supporting")}
                        className="bg-black text-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors text-[10px] md:text-xs"
                      >
                        <Plus size={14} /> {ui("추가", "Add")}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyCastPresetToSection(selectedCastPresetId, "supporting")}
                      disabled={!selectedCastPresetId}
                      className="mt-2 w-full border-2 border-black bg-white px-3 py-2 font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors text-[10px] md:text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      title={ui("선택된 프리셋의 보조 출연자만 적용", "Apply only supporting cast from selected preset")}
                    >
                      <FolderOpen size={14} /> {ui("프리셋 불러오기", "Load Preset")}
                    </button>
                  </div>
                </div>

                {castSupporting.length === 0 ? (
                  <div className="border-2 border-blue-300 bg-white p-4">
                    <p className="text-[10px] font-bold text-slate-600">
                      {ui('아직 보조 출연자가 없어. (예: "민수의 아버지", "영어 선생님")', 'No supporting cast yet.')}
                    </p>
                  </div>
                ) : (
                  castSupporting.map((c) => (
                    <div key={c.id} className="mb-6 bg-white border-4 border-black p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-black text-[10px] uppercase text-blue-700">{ui("조연", "Supporting")}</p>
                        <button
                          type="button"
                          onClick={() => removeCastMember(c.id)}
                          className="border-2 border-black bg-white px-2 py-1 font-black hover:bg-slate-100 text-[10px] flex items-center gap-1"
                        >
                          <Trash2 size={14} /> {ui("삭제", "Remove")}
                        </button>
                      </div>

                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => updateCastMember(c.id, { name: e.target.value })}
                        placeholder={ui('이름/호칭 (예: "민수의 아버지")', 'Name/title')}
                        className="w-full border-2 border-black p-3 font-bold mb-3 outline-none focus:bg-white text-sm"
                      />
                      <textarea
                        value={c.appearance}
                        onChange={(e) => updateCastMember(c.id, { appearance: e.target.value })}
                        placeholder={ui("외형/복장 (예: 와이셔츠, 안경, 피곤한 표정)", "Appearance/outfit")}
                        className="w-full border-2 border-black p-3 font-bold mb-3 outline-none focus:bg-white text-sm min-h-[76px]"
                      />
                      <textarea
                        value={c.persona || ""}
                        onChange={(e) => updateCastMember(c.id, { persona: e.target.value })}
                        placeholder={ui('페르소나/관계/직업 (예: "엄격하지만 속정 깊음")', 'Persona/relationship/job')}
                        className="w-full border-2 border-black p-3 font-bold mb-3 outline-none focus:bg-white text-sm min-h-[76px]"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <input
                          type="text"
                          value={c.catchphrase || ""}
                          onChange={(e) => updateCastMember(c.id, { catchphrase: e.target.value })}
                          placeholder={ui('말버릇(선택) (예: "그게 말이 돼?")', 'Catchphrase (optional)')}
                          className="w-full border-2 border-black p-3 font-bold outline-none focus:bg-white text-sm"
                        />
                        <select
                          value={(c.catchphrase_frequency || "rare") as CatchphraseFrequency}
                          onChange={(e) => updateCastMember(c.id, { catchphrase_frequency: e.target.value as CatchphraseFrequency })}
                          className="w-full border-2 border-black p-3 font-black outline-none focus:bg-white text-sm"
                        >
                          <option value="rare">{ui("드물게", "Rarely")}</option>
                          <option value="sometimes">{ui("가끔", "Sometimes")}</option>
                          <option value="often">{ui("자주", "Often")}</option>
                        </select>
                      </div>

	                      {renderCharacterReferenceControls(c, {
	                        inputId: `cast-img-${c.id}`,
	                        displayName: String(c.name || "").trim(),
	                        altFallback: "supporting",
	                        panelClassName: "bg-blue-100 border-2 border-black p-3",
	                        titleClassName: "text-[10px] font-black uppercase text-blue-900",
	                        countClassName: "text-[10px] font-bold text-blue-900/70"
	                      })}
                    </div>
                  ))
                )}
              </div>
            </div>

            {creationType === "educational" && questionType === "review" && (
            <div className="mt-8 p-6 bg-slate-50 border-2 border-black">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm font-black text-gray-700 uppercase flex items-center gap-2">
                <Upload size={18} className="text-blue-600" /> {ui("상품 사진(리뷰 모드용, 선택)", "Product Photo (Optional for Review)")}
                </p>
                <p className="text-[10px] font-bold text-slate-600">
                  {productReferenceImages.length}/{MAX_PRODUCT_REF_IMAGES}
                </p>
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                id="product-img"
                className="hidden"
                onChange={(e) => {
                  void addProductReferenceImages(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <label
                htmlFor="product-img"
                className="inline-block bg-black text-white px-4 py-2 font-black cursor-pointer hover:bg-blue-600 transition-colors text-[10px] md:text-xs"
              >
                {ui("상품 사진 업로드", "Upload Product Photo")}
              </label>

              {productReferenceImages.length > 0 ? (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {productReferenceImages.map((url, idx) => (
                    <div key={`product_ref_${idx}`} className="relative border-2 border-black bg-white overflow-hidden aspect-square">
                      <img src={url} alt={`product ref ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeProductReferenceImage(idx)}
                        className="absolute top-1 right-1 bg-white border-2 border-black p-1 hover:bg-slate-100"
                        title={ui("삭제", "Remove")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            )}

            <div className="mt-12 flex flex-col items-end gap-3">
              <p className={`text-[10px] md:text-xs font-black ${canProceedCharacterSetup ? "text-emerald-700" : "text-slate-500"}`}>
                {canProceedCharacterSetup
                  ? ui("준비됐어. 주인공 1명만으로도 다음 단계 진행 가능해.", "Ready. You can continue with just 1 lead character.")
                  : ui("주인공 이름, 외형, 사진 중 하나만 채워도 다음으로 갈 수 있어.", "Add a lead name, appearance, or photo to continue.")}
              </p>
              <button
                onClick={() => void handleGeneratePlan()}
                disabled={!canGeneratePlan}
                className={`px-10 py-5 font-black flex items-center gap-2 uppercase italic transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${creationType === "story" ? "bg-violet-600 text-white hover:bg-violet-700" : creationType === "paper" ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {creationType === "story" ? ui("각색하고 플랜 생성", "Adapt & Plan") : creationType === "paper" ? ui("계속해서 플랜 생성", "Continue & Plan") : ui("분석하고 플랜 생성", "Analyze & Plan")} <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status === AppStatus.STYLE_SELECT && (
          <div className="bg-white border-4 border-black p-6 md:p-10 comic-shadow animate-fade-in">
            <div className="mb-3">
              <PreviousStepButton />
            </div>
            <h2 className="text-2xl md:text-3xl font-black mb-8 border-l-8 border-blue-600 pl-4 uppercase">{ui("02. 아트 디렉션", "02. Art Direction")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(() => {
                const allCategories = ["Webtoon", "Anime", "Manga", "Illustration", "3D/Craft", "Realism", "Uncategorized"].filter(cat =>
                  stylePresets.some(p => (p.category || "Uncategorized") === cat)
                );

                const filteredPresets = stylePresets.filter(p => (p.category || "Uncategorized") === selectedStyleCategory);

                // Auto-select first category if current selection is invalid (e.g. on initial load or preset change)
                // Use useEffect-like logic inside render? No, side effects in render are bad.
                // However, since we initialized state to "Webtoon" it should be fine.
                // If "Webtoon" doesn't exist, we might have empty grid.
                // Better: if filtered is empty and allCategories is not, we might want to guide user?
                // But let's trust "Webtoon" exists or user clicks tab.

                return (
                  <>
                    {/* TABS */}
                    <div className="col-span-2 md:col-span-4 flex flex-wrap gap-2 mb-6">
                      {allCategories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedStyleCategory(cat)}
                          className={`px-6 py-3 text-xs md:text-sm font-black uppercase border-2 transition-all rounded-full ${selectedStyleCategory === cat
                            ? "bg-black text-white border-black scale-105 shadow-md"
                            : "bg-white text-slate-500 border-slate-300 hover:border-black hover:text-black"
                            }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    {/* GRID */}
                    {filteredPresets.map(p => (
                      <div key={p.id} onClick={() => setSelectedPresetId(p.id)} className={`p-4 md:p-6 border-4 cursor-pointer transition-all flex flex-col h-full ${selectedPresetId === p.id ? 'border-blue-600 bg-blue-50 scale-[1.02] shadow-md' : 'border-black hover:bg-slate-50'}`}>
                        <h3 className={`font-black text-xs md:text-sm mb-2 uppercase ${selectedPresetId === p.id ? "text-blue-700" : "text-black"}`}>{p.label}</h3>
                        {selectedPresetId === p.id && (
                          <div className="mt-3 flex justify-end">
                            <CheckCircle2 size={16} className="text-blue-600" />
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>

            <div className="mt-8 p-6 bg-slate-50 border-2 border-black">
              <p className="text-xs font-black text-slate-700 uppercase mb-2">{ui("스타일 레퍼런스(선택)", "Style Reference (Optional)")}</p>

              <input
                type="file"
                accept="image/*"
                id="style-up"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setStyleReferenceError(null);
                  if (!f) return;

                  if (f.size > 6 * 1024 * 1024) {
                    setStyleReferenceError(ui("이미지 용량이 너무 커. 6MB 이하로 업로드해줘.", "Image is too large. Upload an image under 6MB."));
                    setStyleReferenceImage(null);
                    e.currentTarget.value = "";
                    return;
                  }

                  const r = new FileReader();
                  r.onerror = () => setStyleReferenceError(ui("이미지를 불러오지 못했어.", "Could not load the image."));
                  r.onload = (ev) => setStyleReferenceImage(ev.target?.result as string);
                  r.readAsDataURL(f);
                  // Allow re-uploading the same file
                  e.currentTarget.value = "";
                }}
              />

              {styleReferenceError && (
                <p className="text-[10px] font-black text-red-600 mb-3">{styleReferenceError}</p>
              )}

              {!styleReferenceImage ? (
                <label
                  htmlFor="style-up"
                  className="inline-block bg-black text-white px-6 py-3 font-black cursor-pointer hover:bg-blue-600 transition-colors text-[10px] md:text-xs"
                >
                  {ui("스타일 이미지 업로드", "Upload Style Image")}
                </label>
              ) : (
                <div className="flex flex-col md:flex-row gap-4 items-start">
                  <div className="w-40 h-40 border-4 border-black overflow-hidden bg-white">
                    <img src={styleReferenceImage} alt="Style reference" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex gap-2">
                    <label
                      htmlFor="style-up"
                      className="bg-black text-white px-4 py-2 font-black cursor-pointer hover:bg-blue-600 transition-colors text-[10px] md:text-xs"
                    >
                      {ui("변경", "Change")}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setStyleReferenceImage(null);
                        setStyleReferenceError(null);
                      }}
                      className="border-2 border-black bg-white px-4 py-2 font-black hover:bg-slate-100 text-[10px] md:text-xs"
                    >
                      {ui("지우기", "Clear")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-12 flex justify-end items-center">
              <button
                onClick={() => {
                  const nextStyle = resolveCurrentStyle();
                  setFinalStyle(nextStyle);
                  setStatus(AppStatus.CHARACTER_SELECT);
                }}
                disabled={!canProceedMissionSetup || stylePresets.length === 0}
                className="bg-black text-white px-10 py-5 font-black flex items-center gap-2 hover:bg-blue-600 transition-colors uppercase italic disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {ui("다음: 캐릭터 설정", "Next: Character Setup")} <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status === AppStatus.TOPIC_INPUT && (
          <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="bg-white border-4 border-black p-6 md:p-10 comic-shadow">
              <div className="mb-3">
                <PreviousStepButton />
              </div>
              <h2 className="text-2xl md:text-3xl font-black mb-8 uppercase">{ui("01. 작업 설정", "01. The Mission")}</h2>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("제작 유형", "Creation Type")}</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setCreationType("educational");
                      setNarrativeRole(getDefaultNarrativeRole("educational"));
                      setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
                      if (comicMode === "pure_cinematic") setComicMode("learning");
                    }}
                    className={`py-3 border-2 border-black font-black text-xs uppercase transition-colors ${creationType === "educational" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("교육/학습", "Learning")}
                  </button>
                  <button
                    onClick={() => {
                      setCreationType("story");
                      setNarrativeRole(getDefaultNarrativeRole("story"));
                      setComicMode("pure_cinematic");
                      setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
                    }}
                    className={`py-3 border-2 border-black font-black text-xs uppercase transition-colors ${creationType === "story" ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("스토리/창작", "Story")}
                  </button>
                  <button
                    onClick={() => {
                      setCreationType("paper");
                      setNarrativeRole(getDefaultNarrativeRole("paper"));
                      setPublicationFormat("webtoon");
                      setToneMode("normal");
                      setToneLevel("medium");
                      setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
                    }}
                    className={`py-3 border-2 border-black font-black text-xs uppercase transition-colors ${creationType === "paper" ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("논문 만화", "Paper Comic")}
                  </button>
                </div>
              </div>

              {creationType === "educational" && (
              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("만화 모드", "Comic Mode")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setComicMode("learning");
                      setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
                    }}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${comicMode === "learning" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("학습", "Learning")}
                  </button>
                  <button
                    onClick={() => {
                      setComicMode("cinematic");
                      setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
                    }}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${isEduCinematicSelected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("장면형 학습", "Scene-Led")}
                  </button>
                </div>
              </div>
              )}

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("출판 형식", "Publication Format")}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {getSelectablePublicationFormats(creationType).map((fmt) => {
                    const cfg = FORMAT_CONFIGS[fmt];
                    const isActive = publicationFormat === fmt;
                    const colorClass = fmt === "kling_i2v" && isActive
                      ? "bg-blue-600 text-white border-blue-600"
                      : fmt === "webtoon" && isActive
                        ? "bg-green-600 text-white border-green-600"
                        : fmt === "manga" && isActive
                          ? "bg-purple-600 text-white border-purple-600"
                          : isActive
                            ? "bg-black text-white"
                            : "bg-white hover:bg-slate-100";
                    return (
                      <button
                        key={fmt}
                        onClick={() => {
                          if (fmt === publicationFormat) return;
                          setPublicationFormat(fmt);
                          if (isLearningComic(fmt)) setLayoutVariety(DEFAULT_LAYOUT_VARIETY);
                          if (seriesPlan) {
                            setSeriesPlan(null);
                            setPageResults([]);
                            setPageErrors({});
                            setWebtoonEpisodeResult(null);
                            setIsBuildingWebtoonEpisode(false);
                            setPageRenderedAt({});
                            setPageRenderedImageSize({});
                            setPageRenderedEngineKey({});
                            setPageScriptEditedAt({});
                            setPageStyleOverrides({});
                            setPageStyleEditedAt({});
                          }
                        }}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${colorClass}`}
                      >
                        {formatLabel(uiLanguage, cfg.labelKo, cfg.label, cfg.labelKo || cfg.label)}
                      </button>
                    );
                  })}
                </div>
                {isI2VSelected ? (
                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("화면 비율", "Aspect Ratio")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["16:9", "9:16", "1:1"] as I2VAspectRatio[]).map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setI2VAspectRatio(ratio)}
                          className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${i2vAspectRatio === ratio ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {isManga(publicationFormat) ? (
                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("색상 모드", "Color Mode")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setMangaColorMode("bw")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${mangaColorMode === "bw" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                      >
                        {ui("흑백", "B&W")}
                      </button>
                      <button
                        onClick={() => setMangaColorMode("color")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${mangaColorMode === "color" ? "bg-purple-600 text-white border-purple-600" : "bg-white hover:bg-slate-100"}`}
                      >
                        {ui("컬러", "Color")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {creationType === "educational" && (<>
              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("질문 유형", "Question Type")}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <button
                    onClick={() => setQuestionType("explain")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${questionType === "explain" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("설명", "Explain")}
                  </button>
                  <button
                    onClick={() => setQuestionType("compare")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${questionType === "compare" ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("비교", "Compare")}
                  </button>
                  <button
                    onClick={() => {
                      setQuestionType("review");
                      setIntroStyle("standard");
                    }}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${questionType === "review" ? 'bg-yellow-300 text-black' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("리뷰", "Review")}
                  </button>
                </div>
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("도입 방식", "Intro Style")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setIntroStyle("standard")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${introStyle === "standard" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("기본", "Standard")}
                  </button>
                  <button
                    onClick={() => setIntroStyle("myth_busting")}
                    disabled={questionType === "review"}
                    title={questionType === "review" ? ui("리뷰 모드에서는 비활성화돼.", "Disabled in Review mode.") : ui("오해 깨기 오프닝", "Myth-busting opening")}
                    className={`py-2 border-2 font-black text-[10px] uppercase transition-colors ${questionType === "review"
                      ? "border-slate-300 bg-slate-200 text-slate-400 cursor-not-allowed"
                      : introStyle === "myth_busting"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-black bg-white hover:bg-slate-100"
                      }`}
                  >
                    {ui("오해 깨기", "Myth Busting")}
                  </button>
                </div>
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("독자 수준", "Audience")}</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <button
                    onClick={() => setAudienceLevel("kids")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${audienceLevel === "kids" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    Kids
                  </button>
                  <button
                    onClick={() => setAudienceLevel("teen")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${audienceLevel === "teen" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    Teen
                  </button>
                  <button
                    onClick={() => setAudienceLevel("beginner")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${audienceLevel === "beginner" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    Beginner
                  </button>
                  <button
                    onClick={() => setAudienceLevel("intermediate")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${audienceLevel === "intermediate" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    Intermediate
                  </button>
                  <button
                    onClick={() => setAudienceLevel("expert")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${audienceLevel === "expert" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    Expert
                  </button>
                </div>
              </div>
              </>)}

              {creationType === "story" && (<>
              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("입력 형태", "Input Type")}</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setStoryInputType("script")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${storyInputType === "script" ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("대본/시나리오", "Script")}
                  </button>
                  <button
                    onClick={() => setStoryInputType("prose")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${storyInputType === "prose" ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("소설/산문", "Prose")}
                  </button>
                  <button
                    onClick={() => setStoryInputType("scenario")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${storyInputType === "scenario" ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("상황/설정", "Scenario")}
                  </button>
                </div>
              </div>

              <div className="mb-8">
                <p className="text-sm font-bold text-slate-500 mb-4 uppercase">
                  {storyInputType === "script" ? ui("대본을 입력해줘", "Enter a script") : storyInputType === "prose" ? ui("소설/산문 텍스트를 입력해줘", "Enter prose text") : ui("어떤 상황/설정이야?", "What is the situation or premise?")}
                </p>
                <textarea
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder={storyInputType === "script"
                    ? ui("예:\n(장면: 어두운 골목길, 비가 내린다)\n\n지수: 여기서 기다리라고 했잖아.\n민호: (뒤돌아보며) 기다릴 시간이 없어.", "Example:\n(Scene: A dark alley in the rain.)\n\nJisoo: I told you to wait here.\nMinho: We don't have time to wait.")
                    : storyInputType === "prose"
                      ? ui("예:\n비가 쏟아지는 골목길에서 지수는 민호의 등을 바라보고 있었다...", "Example:\nIn the rain-soaked alley, Jisoo watched Minho's back...")
                      : ui("예:\n고등학생 지수가 우연히 시간여행 능력을 얻게 된다.", "Example:\nA high school student accidentally gains the ability to travel through time.")}
                  className="w-full border-4 border-black p-4 md:p-6 text-sm font-mono mb-2 outline-none focus:bg-violet-50 h-48 resize-y"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400">{scriptText.length.toLocaleString()}{ui("자", " chars")}</p>
                  <label className="flex items-center gap-1 text-[10px] font-black uppercase bg-white border-2 border-black px-2 py-1 hover:bg-yellow-50 cursor-pointer">
                    <Upload size={12} /> {ui("파일 업로드", "Upload File")}
                    <input
                      type="file"
                      accept=".txt,.md,text/plain"
                      className="hidden"
                      onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ""; }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => { if (typeof reader.result === "string") setScriptText(reader.result); };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={handleAnalyzeStory}
                    disabled={isStoryAnalyzing || scriptText.trim().length < 50}
                    className="bg-violet-600 text-white px-4 py-2 text-xs font-black hover:bg-violet-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {isStoryAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles size={14} />}
                    스토리 분석
                  </button>
                  {storyDigestText && (
                    <button
                      onClick={() => { setStoryDigestText(""); setStoryDigestWarnings([]); setStoryPageSuggestions(null); setStoryDigestError(null); }}
                      className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase"
                    >
                      초기화
                    </button>
                  )}
                </div>
                {storyDigestError && (
                  <p className="text-[10px] font-black text-red-600 mt-2">스토리 분석 오류: {storyDigestError}</p>
                )}
                {storyDigestWarnings.length > 0 && (
                  <div className="border-2 border-yellow-400 bg-yellow-50 p-3 mt-3">
                    <p className="text-[10px] font-black uppercase text-yellow-800 mb-1">{ui("경고", "Warnings")}</p>
                    <ul className="list-disc pl-4 text-[10px] font-bold text-yellow-900 space-y-1">
                      {storyDigestWarnings.slice(0, 6).map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {storyDigestText && (
                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("스토리 브리프", "Story Brief")}</p>
                    <textarea
                      value={storyDigestText}
                      onChange={(e) => setStoryDigestText(e.target.value)}
                      className="w-full border-2 border-black p-3 font-mono text-[10px] bg-white h-48 resize-y"
                    />
                  </div>
                )}
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("연령 등급", "Age Rating")}</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setAgeRating("all_ages")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${ageRating === "all_ages" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    전체 이용가
                  </button>
                  <button
                    onClick={() => setAgeRating("teen")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${ageRating === "teen" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    청소년 (PG-13)
                  </button>
                  <button
                    onClick={() => setAgeRating("mature")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${ageRating === "mature" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    성인
                  </button>
                </div>
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("스토리 가드(실험)", "Story Guard (Experimental)")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setStoryAntiEducationGuardEnabled(true)}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${storyAntiEducationGuardEnabled ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("가드 ON", "Guard On")}
                  </button>
                  <button
                    onClick={() => setStoryAntiEducationGuardEnabled(false)}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${!storyAntiEducationGuardEnabled ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("가드 OFF", "Guard Off")}
                  </button>
                </div>
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("장르 힌트(선택)", "Genre Hint (Optional)")}</p>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {(["action", "romance", "horror", "comedy", "drama", "fantasy", "sci_fi", "slice_of_life", "mystery"] as StoryGenre[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setStoryGenre(storyGenre === g ? null : g)}
                      className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${storyGenre === g ? 'bg-violet-600 text-white border-violet-600' : 'bg-white hover:bg-slate-100'}`}
                    >
                      {uiLanguage === "ko"
                        ? (g === "sci_fi" ? "SF" : g === "slice_of_life" ? "일상" : g === "action" ? "액션" : g === "romance" ? "로맨스" : g === "horror" ? "호러" : g === "comedy" ? "코미디" : g === "drama" ? "드라마" : g === "fantasy" ? "판타지" : "미스터리")
                        : (g === "sci_fi" ? "Sci-Fi" : g === "slice_of_life" ? "Slice of Life" : g.replace("_", " "))}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("페이싱", "Pacing")}</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setPacingPreference("fast")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${pacingPreference === "fast" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("빠르게", "Fast")}
                  </button>
                  <button
                    onClick={() => setPacingPreference("balanced")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${pacingPreference === "balanced" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("균형", "Balanced")}
                  </button>
                  <button
                    onClick={() => setPacingPreference("slow")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${pacingPreference === "slow" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("천천히", "Slow")}
                  </button>
                </div>
              </div>
              </>)}

              {creationType === "paper" && (
                <>
                  <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("독자 수준", "Audience")}</p>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {(["kids", "teen", "beginner", "intermediate", "expert"] as AudienceLevel[]).map((level) => (
                        <button
                          key={level}
                          onClick={() => setAudienceLevel(level)}
                          className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${audienceLevel === level ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white hover:bg-slate-100'}`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>

	                  <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
	                    <p className="text-xs font-black text-slate-700 uppercase mb-4 flex items-center gap-2">
	                      <FileText size={14} /> {ui("논문 자료", "Paper Source")}
	                    </p>
	                    <div className="flex flex-col md:flex-row gap-2 mb-4">
	                      <input
	                        type="url"
	                        value={paperUrl}
	                        onChange={(e) => {
	                          setPaperUrl(e.target.value);
	                          setPaperBriefError(null);
	                        }}
	                        onKeyDown={(e) => {
	                          if (e.key === "Enter") void runPaperUrlAnalysis();
	                        }}
	                        placeholder={ui("논문 URL 붙여넣기 (arXiv, DOI, PubMed, 저널 페이지 등)", "Paste a paper URL (arXiv, DOI, PubMed, journal page, etc.)")}
	                        className="flex-1 border-2 border-black bg-white px-3 py-2 text-xs font-bold outline-none focus:bg-emerald-50"
	                      />
	                      <button
	                        onClick={() => { void runPaperUrlAnalysis(); }}
	                        disabled={isPaperAnalyzing || !paperUrl.trim()}
	                        className="bg-emerald-600 text-white px-4 py-2 text-xs font-black border-2 border-black hover:bg-emerald-700 transition-colors disabled:opacity-50"
	                      >
	                        {ui("AI 조사", "AI Research")}
	                      </button>
	                    </div>
	                    <div className="flex items-center justify-between gap-3 mb-3">
	                      <p className="text-[10px] font-black uppercase text-slate-500">{ui("또는 PDF 원문 업로드", "Or upload the PDF")}</p>
	                      <label className="flex items-center gap-1 text-[10px] font-black uppercase bg-white border-2 border-black px-2 py-1 hover:bg-emerald-50 cursor-pointer">
	                        <Upload size={12} /> {ui("PDF 업로드", "Upload PDF")}
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          className="hidden"
                          onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ""; }}
                          onChange={(e) => { void handlePaperFileChange(e.target.files?.[0] || null); }}
                        />
	                      </label>
	                    </div>
	                    {paperFile ? (
	                      <p className="text-[10px] font-bold text-slate-500 mb-3">
	                        {ui("업로드됨", "Uploaded")}: <span className="font-black">{paperFile.name}</span>
	                      </p>
	                    ) : paperUrl.trim() ? (
	                      <p className="text-[10px] font-bold text-slate-500 mb-3">
	                        {ui("URL", "URL")}: <span className="font-black break-all">{paperUrl.trim()}</span>
	                      </p>
	                    ) : (
	                      null
	                    )}

                    {isPaperAnalyzing && (
                      <div className="border-2 border-black bg-white p-4 flex items-center gap-3">
	                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
	                        <p className="text-[10px] font-black uppercase">{ui("논문 브리프 추출 중...", "Extracting paper brief...")}</p>
	                      </div>
	                    )}

                    {paperBriefError && (
                      <p className="text-[10px] font-black text-red-600">{paperBriefError}</p>
                    )}

                    {paperBrief && !isPaperAnalyzing && (
                      <div className="border-2 border-black bg-white p-4 space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-black uppercase">
                            {ui("브리프 검토", "Brief Review")}
                          </span>
                          <span className="border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase">
                            {paperTrackLabel}
                          </span>
                          <span className="border-2 border-black px-2 py-0.5 text-[10px] font-black uppercase bg-slate-50">
                            {paperBrief.domain_guess || ui("학술 논문", "Academic Paper")}
                          </span>
                        </div>

	                        <div>
	                          <p className="text-sm md:text-base font-black">{paperBrief.paper_title}</p>
	                          <p className="text-[11px] font-bold text-slate-600 mt-2">{paperBrief.one_line_takeaway}</p>
	                        </div>

	                        {(paperBrief.paper_story_units || []).length > 0 && (
	                          <div className="border-2 border-black bg-emerald-50 p-3 text-[10px] font-bold text-slate-700">
	                            <p className="font-black uppercase mb-2 text-emerald-700">{ui("논문 전개 흐름", "Paper Story Flow")}</p>
	                            <div className="space-y-1">
	                              {(paperBrief.paper_story_units || []).slice(0, 6).map((unit, index) => (
	                                <p key={index}>- {unit.step}: {unit.reader_question}</p>
	                              ))}
	                            </div>
	                          </div>
	                        )}

	                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-bold text-slate-700">
	                          <div className="border-2 border-black bg-emerald-50 p-3">
	                            <p className="font-black uppercase mb-2 text-emerald-700">{ui("배경과 문제의 틈", "Background & Gap")}</p>
	                            <p>{paperBrief.motivation_context || "연구 필요성은 본문 근거가 더 필요해 보수적으로 비워뒀습니다."}</p>
	                          </div>
                          <div className="border-2 border-black bg-slate-50 p-3">
                            <p className="font-black uppercase mb-2 text-slate-500">{ui("독자용 도입 예시", "Reader Hook")}</p>
                            <p>{paperBrief.reader_hook_example || "도입 예시는 논문 맥락에서 안전하게 유도되지 않아 생략됐습니다."}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-bold text-slate-700">
                          <div className="border-2 border-black bg-slate-50 p-3">
                            <p className="font-black uppercase mb-2 text-slate-500">{ui("연구 질문", "Research Question")}</p>
                            <p>{paperBrief.research_question || paperBrief.core_problem || "핵심 연구 질문이 보수적으로 요약되지 않았습니다."}</p>
                          </div>
                          <div className="border-2 border-black bg-slate-50 p-3">
                            <p className="font-black uppercase mb-2 text-slate-500">{ui("기존 한계", "Prior Limitations")}</p>
                            <div className="space-y-1">
                              {paperBrief.prior_limitations.slice(0, 3).map((item, index) => (
                                <p key={index}>- {item}</p>
                              ))}
                              {paperBrief.prior_limitations.length === 0 && <p>{ui("- 기존 접근 한계는 논문 본문 기준으로 더 보수적으로 해석돼.", "- Prior limitations were conservatively interpreted from the paper body.")}</p>}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-bold text-slate-700">
                          <div className="border-2 border-black bg-slate-50 p-3">
                            <p className="font-black uppercase mb-2 text-slate-500">{ui("핵심 기여", "Main Contributions")}</p>
                            <div className="space-y-1">
                              {paperBrief.main_contributions.slice(0, 3).map((item, index) => (
                                <p key={index}>- {item}</p>
                              ))}
                            </div>
                          </div>
                          <div className="border-2 border-black bg-slate-50 p-3">
                            <p className="font-black uppercase mb-2 text-slate-500">{ui("한계", "Limitations")}</p>
                            <div className="space-y-1">
                              {paperBrief.limitations.slice(0, 3).map((item, index) => (
                                <p key={index}>- {item}</p>
                              ))}
                              {paperBrief.limitations.length === 0 && <p>{ui("- 명시적 한계가 적어 보수적으로 요약돼.", "- Explicit limitations were sparse, so this was summarized conservatively.")}</p>}
                            </div>
                          </div>
                        </div>

                        {(paperBrief.warnings || []).length > 0 && (
                          <div className="border-2 border-yellow-400 bg-yellow-50 p-3">
                            <p className="text-[10px] font-black uppercase text-yellow-800 mb-1">{ui("경고", "Warnings")}</p>
                            <div className="space-y-1 text-[10px] font-bold text-yellow-900">
                              {paperBrief.warnings.slice(0, 4).map((item, index) => (
                                <p key={index}>- {item}</p>
                              ))}
                            </div>
                          </div>
                        )}

	                        <div className="flex items-center gap-2">
	                          <button
	                            onClick={() => {
	                              if (paperFile) void runPaperAnalysis(paperFile);
	                              else void runPaperUrlAnalysis();
	                            }}
	                            disabled={(!paperFile && !paperUrl.trim()) || isPaperAnalyzing}
	                            className="bg-white text-black px-4 py-2 text-xs font-black border-2 border-black hover:bg-slate-100 transition-colors disabled:opacity-50"
	                          >
                            {ui("재분석", "Re-analyze")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">
                  {isPaperSelected ? ui("논문 톤", "Paper Tone") : creationType === "story" ? ui("스토리 톤", "Story Tone") : ui("톤", "Tone")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setToneMode("normal")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${toneMode === "normal" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("일반", "Normal")}
                  </button>
                  <button
                    onClick={() => setToneMode("gag")}
                    className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${toneMode === "gag" ? 'bg-yellow-300 text-black' : 'bg-white hover:bg-slate-100'}`}
                  >
                    {ui("개그", "Gag")}
                  </button>
                </div>
                {toneMode === "gag" && (
                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("개그 강도", "Gag Level")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setToneLevel("low")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${toneLevel === "low" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                      >
                        {ui("약", "Low")}
                      </button>
                      <button
                        onClick={() => setToneLevel("medium")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${toneLevel === "medium" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                      >
                        {ui("중", "Medium")}
                      </button>
                      <button
                        onClick={() => setToneLevel("high")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${toneLevel === "high" ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}
                      >
                        {ui("강", "High")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!isPaperSelected && (
              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("말투/제스처", "Tone & Gesture")}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {DELIVERY_STYLE_PRESETS.map((p) => {
                    const disabled =
                      p.id === "sensual_pg13" && (audienceLevel === "kids" || audienceLevel === "teen");
                    return (
                      <button
                        key={p.id}
                        onClick={() => setDeliveryStyleId(p.id)}
                        disabled={disabled}
                        title={disabled ? ui("어린이/청소년 독자에는 사용할 수 없어.", "Not available for Kids/Teen audiences.") : p.label}
                        className={`py-2 border-2 font-black text-[10px] uppercase transition-colors ${disabled
                          ? "border-slate-300 bg-slate-200 text-slate-400 cursor-not-allowed"
                          : deliveryStyleId === p.id
                            ? "border-blue-600 bg-blue-50 text-blue-700"
                            : "border-black bg-white hover:bg-slate-100"
                          }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                {deliveryStyleId === "custom" && (
                  <div className="mt-3">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("커스텀 지시", "Custom Instruction")}</p>
                    <textarea
                      value={deliveryCustomInstruction}
                      onChange={(e) => setDeliveryCustomInstruction(e.target.value)}
                      placeholder={ui('예: "아주 건조한 사무적인 말투 + 손짓 최소화"', 'Example: "very dry office tone + minimal gestures"')}
                      className="w-full border-2 border-black p-3 font-mono text-[10px] bg-white h-24 resize-y"
                    />
                  </div>
                )}
              </div>
              )}

              {creationType === "educational" && (<>
              <p className="text-sm font-bold text-slate-500 mb-4 uppercase">
                {isPureCinematicSelected ? ui("어떤 이야기를 보여줄까?", "What story should we show?") : ui("무엇을 학습해볼까?", "What should we learn?")}
              </p>
              <input
                type="text"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  clearResearchDigest();
                }}
                aria-invalid={isTopicRequiredMissing}
                aria-describedby={isTopicRequiredMissing ? "topic-required-message" : undefined}
                placeholder={ui("예: as if 사용법, 광합성 원리", "Example: how to use 'as if', photosynthesis")}
                className={`w-full border-4 p-4 md:p-6 text-lg md:text-xl font-bold outline-none transition-colors ${
                  isTopicRequiredMissing
                    ? "border-red-600 bg-red-50 placeholder-red-300 focus:bg-red-50 focus:ring-4 focus:ring-red-100"
                    : "border-black bg-white focus:bg-yellow-50"
                } ${isTopicRequiredMissing ? "mb-2" : "mb-8"}`}
              />
              {isTopicRequiredMissing && (
                <p id="topic-required-message" className="mb-8 text-xs font-black text-red-600">
                  {ui("필수 입력 항목이야. 학습할 주제를 먼저 입력해줘.", "Required field. Enter the topic to learn first.")}
                </p>
              )}
              </>)}

              <div className="mb-8">
                {creationType === "educational" && (<>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={handleAnalyzeResearch}
                    disabled={isResearchAnalyzing || !(topic.trim() || researchReportText.trim() || researchReportFile)}
                    className="w-full min-h-[60px] bg-black text-white px-5 py-4 text-base font-black hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:bg-slate-400 disabled:opacity-100 disabled:cursor-not-allowed"
                  >
                    {isResearchAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe size={14} />}
                    {ui("AI로 핵심 정리하기", "Summarize with AI")}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-[10px] font-black uppercase text-slate-500">{ui("선택 자료 추가", "Optional material")}</span>
                    <label className="flex items-center justify-center gap-1 text-[10px] font-black uppercase bg-white border-2 border-black px-3 py-2 hover:bg-yellow-50 cursor-pointer">
                      <Upload size={12} /> {ui("PDF/TXT", "PDF/TXT")}
                      <input
                        type="file"
                        accept=".txt,.md,.json,.pdf,text/plain,application/json,application/pdf"
                        className="hidden"
                        onClick={(e) => {
                          (e.currentTarget as HTMLInputElement).value = "";
                        }}
                        onChange={(e) => handleResearchFileChange(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsManualMaterialOpen((prev) => !prev)}
                      className={`flex items-center justify-center gap-1 text-[10px] font-black uppercase border-2 border-black px-3 py-2 transition-colors ${
                        isManualMaterialOpen ? "bg-yellow-50" : "bg-white hover:bg-slate-100"
                      }`}
                    >
                      <FileText size={12} /> {ui("직접 입력", "Paste")}
                    </button>
                  </div>

                  {(researchReportFile || researchDigestText) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {researchReportFile && (
                        <>
                          <p className="text-[10px] font-bold text-slate-500">
                            {ui("업로드됨", "Uploaded")}: <span className="font-black">{researchReportFile.name}</span>
                          </p>
                          <button
                            type="button"
                            onClick={() => handleResearchFileChange(null)}
                            className="text-[10px] font-black uppercase bg-white border-2 border-black px-2 py-1 hover:bg-slate-100"
                          >
                            {ui("파일 지우기", "Clear File")}
                          </button>
                        </>
                      )}
                      {researchDigestText && (
                        <button
                          type="button"
                          onClick={clearResearchDigest}
                          className="bg-white text-black px-3 py-1 text-[10px] font-black border-2 border-black hover:bg-slate-100 transition-colors"
                        >
                          {ui("초기화", "Reset")}
                        </button>
                      )}
                    </div>
                  )}

                  {isManualMaterialOpen && (
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("자료 직접 입력", "Enter Material")}</p>
                      <textarea
                        value={researchReportText}
                        onChange={(e) => {
                          setResearchReportText(e.target.value);
                          clearResearchDigest();
                        }}
                        placeholder={ui("수업자료, 설명문, 기사, 유튜브 대본, 교재 내용을 붙여넣어줘.", "Paste class notes, articles, transcripts, or textbook text here.")}
                        className="w-full border-2 border-black p-3 font-mono text-[10px] bg-white h-36 resize-y"
                      />
                    </div>
                  )}

                  {researchDigestError && (
                    <p className="text-[10px] font-black text-red-600">{ui("Digest 오류", "Digest Error")}: {researchDigestError}</p>
                  )}

                  {researchDigestWarnings.length > 0 && (
                    <div className="border-2 border-yellow-400 bg-yellow-50 p-3">
                      <p className="text-[10px] font-black uppercase text-yellow-800 mb-1">{ui("경고", "Warnings")}</p>
                      <ul className="list-disc pl-4 text-[10px] font-bold text-yellow-900 space-y-1">
                        {researchDigestWarnings.slice(0, 6).map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {researchDigestText && (
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("Digest 결과", "Digest Result")}</p>
                      <textarea
                        value={researchDigestText}
                        onChange={(e) => setResearchDigestText(e.target.value)}
                        className="w-full border-2 border-black p-3 font-mono text-[10px] bg-white h-40 resize-y"
                      />
                    </div>
                  )}
                </div>
                </>)}

                <div className={`${creationType === "educational" ? "mt-8 border-t-2 border-slate-200 pt-6" : ""} grid grid-cols-1 md:grid-cols-2 gap-4`}>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">
                      {isPaperSelected ? ui("길이", "Length") : ui("스크립트 상세도", "Script Detail")}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setScriptDetail("brief")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${scriptDetail === "brief" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                      >
                        {ui("간단히", "Brief")}
                      </button>
                      <button
                        onClick={() => setScriptDetail("normal")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${scriptDetail === "normal" ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-slate-100"}`}
                      >
                        {ui("보통", "Normal")}
                      </button>
                      <button
                        onClick={() => setScriptDetail("detailed")}
                        className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${scriptDetail === "detailed" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                      >
                        {ui("자세히", "Detailed")}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">
                      {isPaperSelected ? ui("추천 페이지 수", "Recommended Page Count") : ui("페이지 수", "Page Count")}
                    </p>
                    {isPaperSelected ? (
                      <p className="text-[10px] font-bold text-slate-500">
                        {ui("추천", "Recommended")}: <span className="font-black">{targetPageCount}P</span>
                        {!paperBrief ? ui(" (PDF 분석 후 자동 계산)", " (auto after PDF analysis)") : ui(" (논문 브리프 기준 자동 계산)", " (auto from paper brief)")}
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <button
                            onClick={() => setPageCountMode("auto")}
                            className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${pageCountMode === "auto" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                          >
                            {ui("자동", "Auto")}
                          </button>
                          <button
                            onClick={() => setPageCountMode("manual")}
                            className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${pageCountMode === "manual" ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-slate-100"}`}
                          >
                            {ui("수동", "Manual")}
                          </button>
                        </div>

                        {pageCountMode === "manual" ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={MAX_PAGE_COUNT}
                              step={1}
                              value={targetPageCount}
                              onChange={(e) => {
                                const next = Number.parseInt(e.target.value || "1", 10);
                                setTargetPageCount(clampPageCount(Number.isFinite(next) ? next : 1));
                              }}
                              className="w-20 px-3 py-2 text-xs font-black border-2 border-black bg-white outline-none focus:bg-yellow-50"
                              aria-label="Target page count"
                            />
                            <span className="text-[10px] font-black uppercase text-slate-500">P</span>
                          </div>
                        ) : (
                          <p className="text-[10px] font-bold text-slate-500">
                            {creationType === "story" && !storyPageSuggestions ? (
                              <>{ui("대기", "Waiting")}: <span className="font-black">{ui("스토리 분석 후 자동 결정", "auto after story analysis")}</span></>
                            ) : creationType === "educational" && !pageSuggestions ? (
                              <>{ui("대기", "Waiting")}: <span className="font-black">{ui("AI 핵심 정리 후 자동 결정", "auto after AI summary")}</span></>
                            ) : (
                              <>{ui("추천", "Recommended")}: <span className="font-black">{targetPageCount}P</span></>
                            )}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className={`grid grid-cols-1 ${isLearningComicSelected ? "md:grid-cols-3" : "md:grid-cols-2"} gap-8 mb-8`}>
                {isLearningComicSelected ? (
                  <div>
                    <p className="text-xs font-black text-slate-400 mb-3 uppercase flex items-center gap-2"><LayoutGrid size={14} /> {ui("레이아웃", "Layout Type")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {["low", "medium", "high"].map((v) => (
                        <button key={v} onClick={() => setLayoutVariety(v as LayoutVariety)} className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${layoutVariety === v ? 'bg-black text-white' : 'bg-white hover:bg-slate-100'}`}>
                          {v === 'low' ? ui('단순', 'Simple') : v === 'medium' ? ui('다이내믹', 'Dynamic') : ui('프로 · 추천', 'Pro · Recommended')}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-black text-slate-400 mb-3 uppercase flex items-center gap-2"><Layers size={14} /> {ui("해상도", "Resolution")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {IMAGE_SIZE_OPTIONS.map((s) => (
                      <button key={s} onClick={() => handleImageSizeChange(s)} className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${imageSize === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-100'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-black text-slate-400 mb-3 uppercase flex items-center gap-2"><Globe size={14} /> {ui("결과물 언어", "Output Language")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setLanguage("ko")}
                      className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${language === "ko" ? "bg-black text-white" : "bg-white hover:bg-slate-100"
                        }`}
                    >
                      한국어
                    </button>
                    <button
                      onClick={() => setLanguage("en")}
                      className={`py-2 border-2 border-black font-black text-[10px] uppercase transition-colors ${language === "en" ? "bg-black text-white" : "bg-white hover:bg-slate-100"
                        }`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>

              <div className="mb-8 p-6 bg-slate-50 border-2 border-black">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-1">{ui("플래너 모델", "Planner Model")}</p>
                    <p className="text-xs font-black text-slate-800">Codex OAuth</p>
                    {!hasApiKey && (
                      <p className="text-[10px] font-black text-red-600 mt-2">
                        {ui("로컬 서버가 연결되지 않아서 최종 플랜 생성을 시작할 수 없어.", "Local server is not connected, so plan generation cannot start.")}
                      </p>
                    )}
                  </div>
                  <div className="md:min-w-[260px]">
                    <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("추론 강도", "Reasoning Effort")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setGeminiReasoningEffort("low")}
                        className={`py-2 border-2 font-black text-[10px] uppercase transition-colors ${geminiReasoningEffort === "low" ? "border-black bg-black text-white" : "border-black bg-white hover:bg-slate-100"}`}
                      >
                        low
                      </button>
                      <button
                        onClick={() => setGeminiReasoningEffort("medium")}
                        className={`py-2 border-2 font-black text-[10px] uppercase transition-colors ${geminiReasoningEffort === "medium" ? "border-black bg-black text-white" : "border-black bg-white hover:bg-slate-100"}`}
                      >
                        medium
                      </button>
                      <button
                        onClick={() => setGeminiReasoningEffort("high")}
                        className={`py-2 border-2 font-black text-[10px] uppercase transition-colors ${geminiReasoningEffort === "high" ? "border-black bg-black text-white" : "border-black bg-white hover:bg-slate-100"}`}
                      >
                        high
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStatus(AppStatus.STYLE_SELECT)}
                disabled={!canProceedMissionSetup}
                className="w-full py-6 font-black text-lg md:text-xl bg-black text-white hover:bg-blue-600 transition-all uppercase italic shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                <Palette className="w-6 h-6" /> {ui("다음: 그림체 선택", "Next: Choose Art Style")} <ArrowRight />
              </button>
            </div>
          </div>
        )}

        {status === AppStatus.PLANNING && (
          <div className="relative flex flex-col items-center justify-center py-24 md:py-32 bg-white border-4 border-black comic-shadow max-w-xl mx-auto">
            <div className="absolute top-4 left-4">
              <PreviousStepButton />
            </div>
            <Loader2 className="animate-spin w-16 h-16 text-blue-600 mb-6" />
            <p className="font-black text-xl md:text-2xl uppercase italic tracking-tighter">
              {busyPhase === "translating" ? ui("언어 재생성 중...", "Regenerating Language...") : ui("AI 분석 중...", "AI Deep-Dive Analyzing...")}
            </p>
            <p className="text-xs font-bold text-slate-400 mt-2 uppercase text-center px-4">
              {busyPhase === "translating"
                ? ui("같은 플랜을 유지한 채 텍스트 언어만 바꾸는 중이야.", "Changing only the text language while keeping the same plan.")
                : creationType === "paper"
                  ? ui("논문 구조를 읽고 설명 만화용 페이지 흐름으로 재구성하는 중이야.", "Reading the paper structure and rebuilding it as an explanatory comic flow.")
                  : ui("주제를 조사하고 주인공의 역할을 설계 중이야.", "Researching the topic and designing the protagonist role.")}
            </p>
          </div>
        )}

        {status === AppStatus.PLAN_REVIEW && seriesPlan && (
          <div className="bg-white border-4 border-black p-6 md:p-10 comic-shadow animate-fade-in max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="bg-black text-white p-2">
                  <Monitor size={20} />
                </div>
                <h2 className="text-2xl md:text-3xl font-black uppercase">{ui("04. 내러티브 플랜", "04. Narrative Plan")}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDevPromptCheckOpen(true)}
                  className="border-2 border-black bg-white hover:bg-yellow-100 px-3 py-2 text-[10px] font-black uppercase flex items-center gap-2"
                  title={ui("프롬프트/결과를 복사해 디버깅에 사용", "Copy prompts/results for debugging")}
                >
                  <Copy size={14} /> {ui("프롬프트 체크", "Prompt Check")}
                </button>
                <PreviousStepButton />
              </div>
            </div>

            <div className="mb-8 p-6 bg-yellow-50 border-4 border-black rotate-1">
              <h4 className="flex items-center gap-2 text-sm font-black uppercase text-blue-600 mb-2">
                <Lightbulb size={18} /> {ui("핵심 인사이트", "The Core Insight")}
              </h4>
              <p className="text-lg font-black leading-tight">
                {seriesPlan.plan_meta.rationale_short}
              </p>
              <div className="mt-4 inline-block bg-blue-600 text-white px-2 py-1 text-[10px] font-black uppercase">
                {ui("역할", "Role")}: {narrativeRole === "narrator" ? ui("가이드/관찰자", "Guide/Observer") : ui("배우/수행자", "Actor/Performer")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="inline-block bg-black text-white px-2 py-1 text-[10px] font-black uppercase">
                  {ui("독자", "Audience")}: {audienceLevel}
                </div>
                <div className="inline-block bg-white text-black border-2 border-black px-2 py-1 text-[10px] font-black uppercase">
                  {ui("결과물 언어", "Output Language")}: {seriesPlan.series_spec.series.language === "en" ? "EN" : "KO"}
                </div>
                <div className="inline-block bg-white text-black border-2 border-black px-2 py-1 text-[10px] font-black uppercase">
                  {ui("말투", "Tone")}: {(DELIVERY_STYLE_PRESETS.find((p) => p.id === deliveryStyleId) || DELIVERY_STYLE_PRESETS[0]).label}
                </div>
              </div>
            </div>

            <div className="mb-10 bg-blue-50 border-2 border-blue-200 p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-black text-blue-800 uppercase flex items-center gap-2 mb-1">
                    <Settings2 size={16} /> {ui("페이지 길이", "Page Length")}
                  </h4>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex bg-white border-2 border-black overflow-hidden">
                    <button
                      onClick={() => switchPlanLanguage("ko")}
                      className={`px-3 py-2 text-[10px] font-black uppercase border-r last:border-r-0 transition-colors ${seriesPlan.series_spec.series.language === "ko" ? "bg-black text-white" : "hover:bg-slate-100"
                        }`}
                      title={ui("한국어로 재생성", "Regenerate in Korean")}
                    >
                      KO
                    </button>
                    <button
                      onClick={() => switchPlanLanguage("en")}
                      className={`px-3 py-2 text-[10px] font-black uppercase transition-colors ${seriesPlan.series_spec.series.language === "en" ? "bg-black text-white" : "hover:bg-slate-100"
                        }`}
                      title={ui("영어로 재생성", "Regenerate in English")}
                    >
                      EN
                    </button>
                  </div>
                  <div className="flex bg-white border-2 border-black overflow-hidden">
                    {[1, 2, 3, 4].map(n => (
                      <button
                        key={n}
                        onClick={() => setTargetPageCount(n)}
                        className={`px-4 py-2 text-xs font-black border-r last:border-r-0 transition-colors ${targetPageCount === n ? 'bg-blue-600 text-white' : 'hover:bg-slate-100'}`}
                      >
                        {n}P
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_PAGE_COUNT}
                      step={1}
                      value={targetPageCount}
                      onChange={(e) => {
                        const next = Number.parseInt(e.target.value || "1", 10);
                        setTargetPageCount(clampPageCount(Number.isFinite(next) ? next : 1));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleGeneratePlan();
                      }}
                      className="w-20 px-3 py-2 text-xs font-black border-2 border-black bg-white outline-none focus:bg-yellow-50"
                      aria-label="Target page count"
                    />
                    <span className="text-[10px] font-black uppercase text-slate-500">P</span>
                  </div>
                  <button onClick={handleGeneratePlan} className="bg-black text-white px-4 py-2 text-xs font-black hover:bg-blue-700 transition-colors flex items-center gap-2">{ui("다시 플랜", "Replan")} <RotateCcw size={12} /></button>
                </div>
              </div>
            </div>

            <div className="space-y-4 mb-8 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {seriesPlan.pages.map((p, i) => (
                <div key={i} className="bg-slate-50 border-2 border-black p-5 flex justify-between items-center group hover:bg-white transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="bg-blue-600 text-white px-2 py-0.5 text-[10px] font-black italic uppercase">{unitLabel} {p.page.index}</span>
                      <h3 className="text-base md:text-lg font-black inline-block truncate max-w-[22rem]">{p.page.chapter_title}</h3>
                      {pageScriptEditedAt[p.page.index] ? (
                        <span className="bg-yellow-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">
                          {ui("수정됨", "Edited")}
                        </span>
                      ) : null}
                      {pageStyleOverrides[p.page.index] ? (
                        <span className="bg-purple-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">
                          {ui("스타일", "Style")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openPageEditAction(p.page.index)}
                      className="border-2 border-black bg-white hover:bg-yellow-100 px-3 py-1 text-[10px] font-black uppercase"
                      title={isI2VSelected ? ui("이 프레임 수정", "Edit this frame") : ui("이 페이지 수정", "Edit this page")}
                    >
                      {ui("수정", "Edit")}
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="text-blue-600" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setStatus(AppStatus.READY_TO_GENERATE)} className="w-full bg-black text-white py-6 font-black text-xl hover:bg-blue-600 transition-colors uppercase italic shadow-2xl flex items-center justify-center gap-3">
              {isI2VSelected ? ui("프레임 생성", "Generate Frames") : ui("최종 만화 생성", "Generate Final Comic")} <ArrowRight />
            </button>
          </div>
        )}

        {(status === AppStatus.READY_TO_GENERATE || status === AppStatus.GENERATING_PANELS) && (
          <div className="space-y-12 animate-fade-in">
            <div className="bg-white border-4 border-black p-4 md:p-6 sticky top-4 md:top-6 z-50 comic-shadow">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <PreviousStepButton className="mb-2" />
                  <p className="text-[10px] font-black uppercase text-blue-700 mb-1">
                    {isI2VSelected ? ui("프레임 생성", "Frame Generation") : ui("이미지 생성", "Image Generation")}
                  </p>
                  <p className="text-lg md:text-2xl font-black italic tracking-tight truncate">{seriesPlan?.series_spec.series.title}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black text-slate-600">
                    {seriesPlan && (
                      <span className="border-2 border-black bg-slate-50 px-2 py-1">
                        {ui("진행", "Progress")}: {generatedProgressLabel}
                      </span>
                    )}
                    <span className="border-2 border-black bg-slate-50 px-2 py-1">
                      {imageSizeSummary} · {imageQualitySummary}
                    </span>
                    <span className="border-2 border-black bg-slate-50 px-2 py-1">
                      {readerModeSummary}
                    </span>
                    {failedUnitCount > 0 ? (
                      <span className="border-2 border-red-500 bg-red-50 px-2 py-1 text-red-700">
                        {failedUnitCount} {isI2VSelected ? ui("프레임 실패", "frame failed") : ui("페이지 실패", "page failed")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {nextPendingPage && (
                    <button
                      type="button"
                      onClick={() => generatePage(nextPendingPage.page.index)}
                      disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
                      className={`px-4 py-3 border-2 border-black text-[10px] md:text-xs font-black uppercase flex items-center gap-2 ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                    >
                      {isProcessingPageIndex === nextPendingPage.page.index ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                      {autoGeneratePages ? ui("자동 생성 중", "Auto running") : `${ui("다음 생성", "Generate next")} ${unitLabel} ${nextPendingPage.page.index}`}
                    </button>
                  )}
                  {seriesPlan && (
                    <button
                      type="button"
                      onClick={() => {
                        if (autoGeneratePages) {
                          setAutoGeneratePages(false);
                          return;
                        }
                        setRegenerateAllPages(false);
                        setRegenerateCursor(1);
                        setAutoGeneratePages(true);
                      }}
                      disabled={pageResults.length >= seriesPlan.pages.length}
                      className={`px-4 py-3 border-2 border-black text-[10px] md:text-xs font-black uppercase ${autoGeneratePages ? "bg-blue-600 text-white" : pageResults.length >= seriesPlan.pages.length ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
                    >
                      {autoGeneratePages ? ui("자동 생성 끄기", "Stop auto") : ui("남은 페이지 자동 생성", "Auto-generate remaining")}
                    </button>
                  )}
                  {seriesPlan && (
                    <button
                      type="button"
                      onClick={downloadAllPagesAsZip}
                      disabled={pageResults.length === 0 || isDownloadingZip}
                      className={`px-4 py-3 border-2 border-black text-[10px] md:text-xs font-black uppercase flex items-center gap-2 ${pageResults.length === 0 || isDownloadingZip ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
                    >
                      {isDownloadingZip ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
                      {ui("ZIP 다운로드", "Download ZIP")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setGenerationSettingsOpen((prev) => !prev)}
                    className={`px-4 py-3 border-2 border-black text-[10px] md:text-xs font-black uppercase flex items-center gap-2 ${generationSettingsOpen ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                  >
                    <Settings2 size={14} />
                    {generationSettingsOpen ? ui("설정 접기", "Hide settings") : ui("생성 설정", "Generation settings")}
                  </button>
                </div>
              </div>

              {generationSettingsOpen && (
                <div className="mt-5 border-t-2 border-black pt-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    {seriesPlan && (
                      <div className="border-2 border-black bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("결과 언어", "Output language")}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => switchPlanLanguage("ko")}
                            disabled={status === AppStatus.GENERATING_PANELS}
                            className={`py-2 border-2 border-black text-[10px] font-black uppercase ${seriesPlan.series_spec.series.language === "ko" ? "bg-black text-white" : "bg-white hover:bg-slate-100"} ${status === AppStatus.GENERATING_PANELS ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            한국어
                          </button>
                          <button
                            onClick={() => switchPlanLanguage("en")}
                            disabled={status === AppStatus.GENERATING_PANELS}
                            className={`py-2 border-2 border-black text-[10px] font-black uppercase ${seriesPlan.series_spec.series.language === "en" ? "bg-black text-white" : "bg-white hover:bg-slate-100"} ${status === AppStatus.GENERATING_PANELS ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            English
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="border-2 border-black bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("해상도", "Resolution")}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {IMAGE_SIZE_OPTIONS.map((size) => (
                          <button
                            key={`ready-size-${size}`}
                            type="button"
                            onClick={() => handleImageSizeChange(size)}
                            disabled={status === AppStatus.GENERATING_PANELS}
                            className={`py-2 border-2 border-black text-[10px] font-black uppercase ${imageSize === size ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-100"} ${status === AppStatus.GENERATING_PANELS ? "cursor-not-allowed opacity-50" : ""}`}
                            title={ui(`${size} 출력 해상도로 변경`, `Switch to ${size} output resolution`)}
                          >
                            {size === "1K" ? ui("1K 빠름", "1K fast") : size === "2K" ? ui("2K 선명", "2K sharp") : ui("4K 고해상도", "4K high-res")}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border-2 border-black bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("이미지 품질", "Image quality")}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(["low", "medium", "high"] as CodexImageQuality[]).map((quality) => (
                          <button
                            key={`codex-quality-${quality}`}
                            type="button"
                            onClick={() => handleCodexImageQualityChange(quality)}
                            disabled={status === AppStatus.GENERATING_PANELS}
                            className={`py-2 border-2 border-black text-[10px] font-black uppercase ${codexImageQuality === quality ? "bg-emerald-600 text-white" : "bg-white hover:bg-slate-100"} ${status === AppStatus.GENERATING_PANELS ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            {quality === "low" ? ui("빠르게", "fast") : quality === "high" ? ui("높게", "high") : ui("보통", "normal")}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="border-2 border-black bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase text-slate-600 mb-2">{ui("보기 방식", "Viewing mode")}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setOutputReaderMode("visual")}
                          className={`py-2 border-2 border-black text-[10px] font-black uppercase ${outputReaderMode === "visual" ? "bg-black text-white" : "bg-white hover:bg-slate-100"}`}
                        >
                          {ui("이미지만", "Images")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOutputReaderMode("visual_plus_script")}
                          className={`py-2 border-2 border-black text-[10px] font-black uppercase ${outputReaderMode === "visual_plus_script" ? "bg-blue-600 text-white" : "bg-white hover:bg-slate-100"}`}
                        >
                          {ui("장면 텍스트", "Scene text")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
                    <div className="border-2 border-black bg-white p-3 lg:col-span-2">
                      <p className="text-[10px] font-black uppercase text-slate-600 mb-1">{ui("이미지 생성 방식", "Image generation")}</p>
                      <p className="text-xs font-black text-slate-800 mt-2">{currentImageEngineLabel}</p>
                    </div>

                    {seriesPlan && (
                      <button
                        type="button"
                        onClick={() => setUseCrossPageStyleConsistency((prev) => !prev)}
                        className={`border-2 border-black p-3 text-left text-[10px] font-black uppercase ${useCrossPageStyleConsistency ? "bg-emerald-600 text-white border-emerald-700" : "bg-white hover:bg-slate-100"}`}
                        title={ui("이전 생성 페이지를 스타일 일관성 참고 이미지로 자동 첨부할지 설정", "Use previous pages as style consistency references")}
                      >
                        <span className="block">{ui("앞 페이지 그림체 이어가기", "Continue page style")}</span>
                        <span className="mt-1 block text-[10px] font-bold opacity-80">{useCrossPageStyleConsistency ? "ON" : "OFF"}</span>
                      </button>
                    )}

                    {seriesPlan && (
                      <button
                        type="button"
                        onClick={() => {
                          if (regenerateAllPages) {
                            cancelInFlightGeneration();
                            return;
                          }
                          setSystemError(null);
                          setAutoGeneratePages(false);
                          setRegenerateCursor(1);
                          setRegenerateAllPages(true);
                        }}
                        className={`border-2 border-black p-3 text-left text-[10px] font-black uppercase ${regenerateAllPages ? "bg-red-600 text-white" : "bg-white hover:bg-slate-100"}`}
                      >
                        <span className="block">{regenerateAllPages ? ui("전체 다시 그리기 중지", "Stop redraw all") : ui("전체 다시 그리기", "Redraw all")}</span>
                        <span className="mt-1 block text-[10px] font-bold opacity-80">
                          {Math.min(Math.max(regenerateCursor - 1, 0), seriesPlan.pages.length)}/{seriesPlan.pages.length}
                        </span>
                      </button>
                    )}

                    {seriesPlan && (
                      <button
                        type="button"
                        onClick={exportCodexHandoffZip}
                        disabled={isExportingCodexHandoff}
                        className={`border-2 border-black p-3 text-left text-[10px] font-black uppercase ${isExportingCodexHandoff ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
                        title={ui("Codex 앱에서 생성할 수 있는 프롬프트/레퍼런스 묶음을 ZIP으로 내보내기", "Export a prompt/reference ZIP for use in Codex")}
                      >
                        <span className="flex items-center gap-2">{isExportingCodexHandoff ? <Loader2 className="animate-spin" size={14} /> : <FileText size={14} />} {ui("Codex 전달 묶음", "Codex handoff")}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-2 border-black bg-yellow-50 px-4 py-3 text-[10px] font-bold text-slate-600">
              <span className="font-black text-slate-900">{ui("현재 설정", "Current settings")}: </span>
              {imageSizeSummary} · {imageQualitySummary} · {currentImageEngineLabel}
            </div>

            {failedUnitCount > 0 ? (
              <div className="border-4 border-red-500 bg-red-50 p-4 md:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase text-red-700 flex items-center gap-2">
                      <AlertTriangle size={15} /> {isI2VSelected ? ui("일부 프레임 생성 실패", "Some frames failed") : ui("일부 페이지 생성 실패", "Some pages failed")}
                    </p>
                    <p className="mt-2 text-[10px] font-bold text-red-800">
                      {ui("이미 만든 결과는 유지했어. 실패한 항목만 다시 생성하거나 건너뛰고 계속 만들 수 있어.", "Existing results are preserved. Redraw only the failed item or skip ahead.")}
                    </p>
                  </div>
                  {pageResults.length > 0 ? (
                    <button
                      type="button"
                      onClick={downloadAllPagesAsZip}
                      disabled={isDownloadingZip}
                      className={`px-4 py-2 border-2 border-black text-[10px] font-black uppercase flex items-center gap-2 ${isDownloadingZip ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
                    >
                      {isDownloadingZip ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
                      {ui("현재까지 ZIP", "ZIP so far")}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 space-y-2">
                  {pageErrorEntries.map((entry) => (
                    <div key={`page_error_banner_${entry.pageIndex}`} className="border-2 border-red-300 bg-white p-3 text-left">
                      <p className="text-[10px] font-black uppercase text-red-700">
                        {unitLabel} {entry.pageIndex}
                      </p>
                      <p className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] font-bold text-slate-700">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="bg-white border-4 border-black p-4 md:p-6 comic-shadow">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase text-blue-700 flex items-center gap-2">
                    <UserCheck size={14} /> {ui("캐릭터 일관성 참고 이미지(선택)", "Character Consistency References (Optional)")}
                  </p>
                </div>
                <p className="text-[10px] font-black uppercase text-slate-500">
                  {ui("캐릭터당 최대", "Max")} {MAX_REF_IMAGES_PER_CHARACTER}
                </p>
              </div>

              {cast.length === 0 ? (
                <div className="border-2 border-black bg-slate-50 p-3">
                  <p className="text-[10px] font-bold text-slate-500">{ui("등록된 캐릭터가 없어. 캐릭터 설정 단계에서 먼저 추가해줘.", "No characters registered. Add them in Character Setup first.")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
	                  {cast.map((c) => {
	                    const roleLabel = c.role === "protagonist" ? ui("주연", "PROTAGONIST") : ui("조연", "SUPPORTING");
	                    const displayName = String(c.name || "").trim() || (c.role === "protagonist" ? ui("주인공", "Protagonist") : ui("조연", "Supporting"));
	                    const inputId = `ready-cast-img-${c.id}`;

	                    return (
	                      <div key={`${c.id}_ready_refs`} className="border-2 border-black bg-slate-50 p-3">
	                        <div className="flex items-center justify-between gap-2 mb-2">
	                          <p className="text-[10px] font-black uppercase text-slate-700 truncate">
	                            {roleLabel} · {displayName}
	                          </p>
	                        </div>

	                        {renderCharacterReferenceControls(c, {
	                          inputId,
	                          displayName,
	                          altFallback: "character",
	                          panelClassName: "bg-transparent",
	                          titleClassName: "sr-only",
	                          countClassName: "text-[10px] font-bold text-slate-500",
	                          uploadDisabled: status === AppStatus.GENERATING_PANELS,
	                          compact: true
	                        })}
	                      </div>
	                    );
	                  })}
                </div>
              )}
            </div>

            {isWebtoonSelected ? (
              <div className="space-y-6">
                <div className="bg-white border-4 border-black p-4 md:p-6 comic-shadow">
                  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase text-emerald-700">{ui("웹툰 리더", "Webtoon Reader")}</p>
                      <h4 className="text-xl md:text-2xl font-black uppercase italic mt-1">{ui("연속 세로 리더", "Continuous Scroll Reader")}</h4>
                      <p className="mt-2 text-[10px] md:text-xs font-bold text-slate-500">
                        {generatedPageCount}/{seriesPlan?.pages.length || 0}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {nextPendingPage ? (
                        <button
                          type="button"
                          onClick={() => generatePage(nextPendingPage.page.index)}
                          disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
                          className={`px-4 py-3 border-2 border-black text-[10px] md:text-xs font-black uppercase ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                        >
                          {autoGeneratePages ? ui("자동 대기 중...", "Auto Queue...") : `${ui("생성", "Generate")} ${unitLabel} ${nextPendingPage.page.index}`}
                        </button>
                      ) : (
                        <div className="px-4 py-3 border-2 border-black bg-emerald-50 text-[10px] md:text-xs font-black uppercase text-emerald-700">
                          {ui("모든 페이지 준비됨", "All Pages Ready")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white border-4 border-black p-4 md:p-6 comic-shadow">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
                    <p className="text-[10px] font-black uppercase text-slate-500">{ui("페이지 컨트롤", "Page Controls")}</p>
                    <p className="text-[10px] font-black uppercase text-slate-500">
                      Segments {webtoonEpisodeResult?.segment_urls.length || 0}
                      {webtoonEpisodeResult ? ` · ${webtoonEpisodeResult.total_height_estimate.toLocaleString()}px` : ""}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {seriesPlan?.pages.map((p) => {
	                      const res = pageResultsMap.get(p.page.index);
	                      const isCur = isProcessingPageIndex === p.page.index;
	                      const pageError = pageErrors[p.page.index] || "";
	                      const nextAfterFailedPage = pageError
	                        ? seriesPlan?.pages.find((candidate) => candidate.page.index > p.page.index && !pageResultsMap.has(candidate.page.index) && !pageErrors[candidate.page.index]) || null
	                        : null;
	                      const editedAt = pageScriptEditedAt[p.page.index] || 0;
                      const styleEditedAt = pageStyleEditedAt[p.page.index] || 0;
                      const renderedAt = pageRenderedAt[p.page.index] || 0;
                      const renderedImageSize = pageRenderedImageSize[p.page.index] || null;
                      const renderedEngineKey = pageRenderedEngineKey[p.page.index] || null;
                      const renderedEngineLabel = getImageEngineChipLabelFromKey(renderedEngineKey);
                      const needsResolutionRedraw = Boolean(res) && Boolean(renderedImageSize) && renderedImageSize !== imageSize;
                      const needsEngineRedraw = Boolean(res) && Boolean(renderedEngineKey) && renderedEngineKey !== currentImageEngineKey;
                      const needsRedraw =
                        Boolean(res) &&
                        (editedAt > renderedAt || styleEditedAt > renderedAt || globalStyleEditedAt > renderedAt || needsResolutionRedraw || needsEngineRedraw);
                      const scrollRole = p.layout.scroll?.segment_role || "beat";

                      return (
                        <div key={`webtoon_row_${p.page.index}`} className="border-2 border-black bg-slate-50 p-3 md:p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="bg-black text-white px-2 py-0.5 text-[10px] font-black uppercase italic">{unitLabel} {p.page.index}</span>
                                <span className="border-2 border-black bg-white px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">{scrollRole}</span>
                                {pageScriptEditedAt[p.page.index] ? (
                                  <span className="bg-yellow-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">{ui("수정됨", "Edited")}</span>
                                ) : null}
                                {pageStyleOverrides[p.page.index] ? (
                                  <span className="bg-purple-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">{ui("스타일", "Style")}</span>
                                ) : null}
	                                {needsRedraw ? (
	                                  <span className="bg-red-500 text-white border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">{ui("재생성 필요", "Redraw")}</span>
	                                ) : null}
	                                {pageError ? (
	                                  <span className="bg-red-50 text-red-700 border-2 border-red-500 px-2 py-0.5 text-[9px] font-black uppercase">{ui("실패", "Failed")}</span>
	                                ) : null}
                                {renderedImageSize ? (
                                  <span className={`border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase ${needsResolutionRedraw ? "bg-amber-200 text-black" : "bg-white text-slate-700"}`}>
                                    {renderedImageSize}
                                  </span>
                                ) : null}
                                {renderedEngineLabel ? (
                                  <span className={`border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase ${needsEngineRedraw ? "bg-emerald-200 text-black" : "bg-white text-slate-700"}`}>
                                    {renderedEngineLabel}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm md:text-base font-black text-slate-800 truncate">{p.page.chapter_title}</p>
                              <p className="mt-1 text-[10px] font-bold text-slate-500 uppercase">
                                {ui("뒤 여백", "Gap After")} {p.layout.scroll?.gap_after_px || 0}px
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openPageEditAction(p.page.index)}
                                className="min-h-[44px] px-4 py-2 border-2 border-black bg-white text-[10px] font-black uppercase hover:bg-yellow-100"
                                title={ui("이 페이지 수정", "Edit this page")}
                              >
                                {ui("수정", "Edit")}
                              </button>
                              {res ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => downloadImage(res.composed_image_url, p.page.index)}
                                    className="min-h-[44px] px-4 py-2 border-2 border-black bg-white text-[10px] font-black uppercase hover:bg-blue-50 flex items-center gap-2"
                                  >
                                    <Download size={12} /> {ui("다운로드", "Download")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => generatePage(p.page.index)}
                                    disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
                                    className={`min-h-[44px] px-4 py-2 border-2 border-black text-[10px] font-black uppercase ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-yellow-100"}`}
                                  >
                                    {isCur ? ui("재생성 중...", "Redrawing...") : ui("재생성", "Redraw")}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => generatePage(p.page.index)}
                                  disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
                                  className={`min-h-[44px] px-4 py-2 border-2 border-black text-[10px] font-black uppercase flex items-center gap-2 ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                                >
                                  {isCur ? <Loader2 className="animate-spin" size={12} /> : null}
                                  {isCur ? ui("생성 중...", "Generating...") : autoGeneratePages ? ui("자동 대기 중...", "Auto Queue...") : ui("페이지 생성", "Generate Page")}
                                </button>
                              )}
                            </div>
	                          </div>

	                          {pageError ? (
	                            <div className="mt-3 border-2 border-red-400 bg-red-50 p-3">
	                              <p className="text-[10px] font-black uppercase text-red-700 flex items-center gap-2">
	                                <AlertTriangle size={12} /> {unitLabel} {p.page.index} {ui("생성 실패", "generation failed")}
	                              </p>
	                              <p className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] font-bold text-slate-700">{pageError}</p>
	                              <div className="mt-3 flex flex-wrap gap-2">
	                                <button
	                                  type="button"
	                                  onClick={() => generatePage(p.page.index)}
	                                  disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
	                                  className={`px-3 py-2 border-2 border-black text-[10px] font-black uppercase ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-red-600 text-white hover:bg-red-700"}`}
	                                >
	                                  {ui("이 항목 다시 생성", "Retry this item")}
	                                </button>
	                                {nextAfterFailedPage ? (
	                                  <button
	                                    type="button"
	                                    onClick={() => generatePage(nextAfterFailedPage.page.index)}
	                                    disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
	                                    className={`px-3 py-2 border-2 border-black text-[10px] font-black uppercase ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
	                                  >
	                                    {ui("건너뛰고 다음", "Skip to next")} {unitLabel} {nextAfterFailedPage.page.index}
	                                  </button>
	                                ) : null}
	                              </div>
	                            </div>
	                          ) : null}

	                          {showNarrativeText ? (
                            <div className="mt-3 border-t-2 border-dashed border-black pt-3">
                              <PageNarrativePreview page={p} compact uiLanguage={uiLanguage} />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white border-4 border-black comic-shadow overflow-hidden">
                  <div className="border-b-4 border-black bg-black px-4 py-3 text-white flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase text-emerald-300">{ui("회차 출력", "Episode Output")}</p>
                      <p className="text-sm md:text-base font-black uppercase italic">{ui("연속 세로 리더", "Continuous Scroll Reader")}</p>
                    </div>
                    <p className="text-[10px] font-black uppercase text-slate-200">
                      {generatedPageCount}/{seriesPlan?.pages.length || 0} pages · {webtoonEpisodeResult?.segment_urls.length || 0} segments
                    </p>
                  </div>

	                  {generatedPageCount === 0 ? (
	                    <div className="p-8 md:p-12 bg-slate-50 text-center">
	                      <p className="text-sm font-black uppercase text-slate-700">{ui("웹툰 리더 대기 중", "Webtoon Reader Waiting")}</p>
	                      {nextPendingPage ? (
                        <button
                          type="button"
                          onClick={() => generatePage(nextPendingPage.page.index)}
                          disabled={autoGeneratePages}
                          className={`mt-6 px-8 py-4 border-4 border-black font-black uppercase italic shadow-lg ${autoGeneratePages ? "bg-slate-300 text-slate-600 cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                        >
                          {autoGeneratePages ? ui("자동 대기 중...", "Auto Queue...") : `${ui("생성", "Generate")} ${unitLabel} ${nextPendingPage.page.index}`}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="bg-[#f4f4f4] px-3 py-4 md:px-6 md:py-6">
                      <div className="mx-auto max-w-[860px] rounded-[28px] border-4 border-black bg-white p-3 md:p-4">
                        {isBuildingWebtoonEpisode && (
                          <div className="mb-4 border-2 border-black bg-yellow-50 px-4 py-3 text-[10px] font-black uppercase text-slate-600">
                            {ui("세로 리더를 다시 조립하는 중...", "Rebuilding vertical reader...")}
                          </div>
                        )}
                        {webtoonEpisodeResult ? (
                          <div className="space-y-0 overflow-hidden rounded-[18px] border-2 border-black bg-white">
                            {webtoonEpisodeResult.segment_urls.map((segmentUrl, segmentIndex) => (
                              <div key={`webtoon_segment_${segmentIndex}`} className="relative border-b-2 border-black last:border-b-0">
                                <div className="absolute left-3 top-3 z-10 border-2 border-black bg-white/90 px-2 py-1 text-[9px] font-black uppercase">
                                  Segment {segmentIndex + 1} · {webtoonEpisodeResult.source_page_indices[segmentIndex]?.join(", ")}
                                </div>
                                <img
                                  src={segmentUrl}
                                  alt={`Webtoon segment ${segmentIndex + 1}`}
                                  className="block w-full h-auto"
                                />
                              </div>
                            ))}
                          </div>
                        ) : rawWebtoonFallbackSegments.length > 0 ? (
                          <div className="space-y-3">
                            <div className="border-2 border-black bg-amber-50 px-4 py-3 text-[10px] font-black uppercase text-amber-800">
                              {ui("리더 조립이 늦어져서 페이지 원본을 먼저 보여주는 중", "Reader assembly is delayed, showing raw page images first.")}
                            </div>
                            <div className="space-y-0 overflow-hidden rounded-[18px] border-2 border-black bg-white">
                              {rawWebtoonFallbackSegments.map((segment, segmentIndex) => (
                                <div key={`webtoon_fallback_${segment.pageIndex}`} className="relative border-b-2 border-black last:border-b-0">
                                  <div className="absolute left-3 top-3 z-10 border-2 border-black bg-white/90 px-2 py-1 text-[9px] font-black uppercase">
                                    Page {segment.pageIndex}
                                  </div>
                                  <img
                                    src={segment.url}
                                    alt={`Webtoon page ${segment.pageIndex}`}
                                    className="block w-full h-auto"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
                            <p className="text-sm font-black uppercase text-slate-600">{ui("리더 조립 대기 중", "Reader Assembly Waiting")}</p>
                            <p className="mt-2 text-[10px] font-bold text-slate-500">{ui("생성된 페이지를 세로 웹툰으로 이어붙이는 중이야.", "Combining generated pages into a vertical webtoon.")}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {isManga(publicationFormat) && (
                  <div className="flex items-center gap-2 mb-4 text-xs font-black text-slate-500 uppercase">
                    <ChevronLeft size={14} /> {ui("오른쪽에서 왼쪽으로 읽기", "Read Right to Left")}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                  {seriesPlan?.pages.map((p, idx) => {
	                    const res = pageResultsMap.get(p.page.index);
	                    const isCur = isProcessingPageIndex === p.page.index;
	                    const isRedrawing = Boolean(res) && isCur;
	                    const pageError = pageErrors[p.page.index] || "";
	                    const nextAfterFailedPage = pageError
	                      ? seriesPlan?.pages.find((candidate) => candidate.page.index > p.page.index && !pageResultsMap.has(candidate.page.index) && !pageErrors[candidate.page.index]) || null
	                      : null;
	                    const editedAt = pageScriptEditedAt[p.page.index] || 0;
                    const styleEditedAt = pageStyleEditedAt[p.page.index] || 0;
                    const hasStyleOverride = Boolean(pageStyleOverrides[p.page.index]);
                    const renderedAt = pageRenderedAt[p.page.index] || 0;
                    const renderedImageSize = pageRenderedImageSize[p.page.index] || null;
                    const renderedEngineKey = pageRenderedEngineKey[p.page.index] || null;
                    const renderedEngineLabel = getImageEngineChipLabelFromKey(renderedEngineKey);
                    const needsResolutionRedraw = Boolean(res) && Boolean(renderedImageSize) && renderedImageSize !== imageSize;
                    const needsEngineRedraw = Boolean(res) && Boolean(renderedEngineKey) && renderedEngineKey !== currentImageEngineKey;
                    const needsRedraw =
                      Boolean(res) &&
                      (editedAt > renderedAt || styleEditedAt > renderedAt || globalStyleEditedAt > renderedAt || needsResolutionRedraw || needsEngineRedraw);
                    const klingPromptPack =
                      isI2VSelected && seriesPlan
                        ? buildKlingI2VPromptPack({ series: seriesPlan.series_spec, page: p })
                        : null;

                    return (
                      <div key={idx} className="bg-white border-4 border-black comic-shadow flex flex-col group transition-transform hover:-translate-y-2">
                        <div className="bg-black text-white p-3 text-xs font-black flex justify-between items-center">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="uppercase italic">{unitLabel} {p.page.index}</span>
                            {pageScriptEditedAt[p.page.index] ? (
                              <span className="bg-yellow-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">
                                {ui("수정됨", "Edited")}
                              </span>
                            ) : null}
                            {hasStyleOverride ? (
                              <span className="bg-purple-200 text-black border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">
                                {ui("스타일", "Style")}
                              </span>
                            ) : null}
	                            {needsRedraw ? (
	                              <span className="bg-red-500 text-white border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase">
	                                {ui("재생성 필요", "Redraw")}
	                              </span>
	                            ) : null}
	                            {pageError ? (
	                              <span className="bg-red-50 text-red-700 border-2 border-red-500 px-2 py-0.5 text-[9px] font-black uppercase">
	                                {ui("실패", "Failed")}
	                              </span>
	                            ) : null}
                            {renderedImageSize ? (
                              <span className={`border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase ${needsResolutionRedraw ? "bg-amber-200 text-black" : "bg-white text-slate-700"}`}>
                                {renderedImageSize}
                              </span>
                            ) : null}
                            {renderedEngineLabel ? (
                              <span className={`border-2 border-black px-2 py-0.5 text-[9px] font-black uppercase ${needsEngineRedraw ? "bg-emerald-200 text-black" : "bg-white text-slate-700"}`}>
                                {renderedEngineLabel}
                              </span>
                            ) : null}
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => openPageEditAction(p.page.index)}
                              className="px-2 py-0.5 text-[9px] bg-white text-black hover:bg-yellow-100 border-2 border-black"
                              title={isI2VSelected ? ui("이 프레임 수정", "Edit this frame") : ui("이 페이지 수정", "Edit this page")}
                            >
                              {ui("수정", "Edit")}
                            </button>
                            {res && (
                              <>
                                <button onClick={() => downloadImage(res.composed_image_url, p.page.index)} className="bg-blue-500 text-white px-2 py-0.5 text-[9px] hover:bg-blue-400"><Download size={10} /></button>
	                                <button
	                                  onClick={() => generatePage(p.page.index)}
	                                  disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
	                                  className={`px-2 py-0.5 text-[9px] ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white text-black hover:bg-yellow-400"
	                                    }`}
                                  title={isCur ? ui("재생성 중...", "Redrawing...") : isI2VSelected ? ui("이 프레임 재생성", "Redraw this frame") : ui("이 페이지 재생성", "Redraw this page")}
                                >
                                  {isCur ? (
                                    <span className="flex items-center gap-1">
                                      <Loader2 className="animate-spin" size={10} />
                                      {ui("재생성 중", "Redrawing")}
                                    </span>
                                  ) : (
	                                    ui("재생성", "Redraw")
	                                  )}
	                                </button>
	                                {pageError && nextAfterFailedPage ? (
	                                  <button
	                                    type="button"
	                                    onClick={() => generatePage(nextAfterFailedPage.page.index)}
	                                    disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
	                                    className={`px-2 py-0.5 text-[9px] ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white text-black hover:bg-slate-200"}`}
	                                    title={`${ui("건너뛰고 다음", "Skip to next")} ${unitLabel} ${nextAfterFailedPage.page.index}`}
	                                  >
	                                    {ui("다음", "Next")}
	                                  </button>
	                                ) : null}
	                              </>
	                            )}
                          </div>
                        </div>
                        <div className={`relative ${previewAspectClass} bg-slate-100 overflow-hidden`}>
                          {res ? (
                            <>
                              <img src={res.composed_image_url} className={`w-full h-full ${isKlingI2VFormat(publicationFormat) ? 'object-cover' : 'object-contain'}`} />
                              {isRedrawing && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-white/70 backdrop-blur-sm">
                                  <Loader2 className="animate-spin text-blue-600 w-12 h-12 mb-4" />
                                  <p className="text-sm font-black uppercase text-blue-600">{isI2VSelected ? ui("프레임 재생성 중...", "Re-drawing Frame...") : ui("페이지 재생성 중...", "Re-drawing Page...")}</p>
                                  <p className="text-[10px] font-bold text-slate-500 mt-2 uppercase">{ui("재생성 중...", "Redrawing...")}</p>
                                </div>
                              )}
	                              {(needsResolutionRedraw || needsEngineRedraw) && !isRedrawing ? (
	                                <div className="absolute left-3 bottom-3 border-2 border-black bg-amber-200 px-2 py-1 text-[9px] font-black uppercase text-black">
	                                  {needsResolutionRedraw ? `${renderedImageSize} -> ${imageSize}` : renderedEngineLabel} {ui("재생성 필요", "redraw needed")}
	                                </div>
	                              ) : null}
	                              {pageError && !isRedrawing ? (
	                                <div className="absolute inset-x-3 top-3 border-2 border-red-500 bg-red-50 p-3 text-left shadow-lg">
	                                  <p className="text-[10px] font-black uppercase text-red-700 flex items-center gap-2">
	                                    <AlertTriangle size={12} /> {ui("재생성 실패", "Redraw failed")}
	                                  </p>
	                                  <p className="mt-1 line-clamp-3 text-[10px] font-bold text-slate-700">{pageError}</p>
	                                </div>
	                              ) : null}
	                            </>
	                          ) : (
	                            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                              {isCur ? (
                                <div className="flex flex-col items-center">
                                  <Loader2 className="animate-spin text-blue-600 w-12 h-12 mb-4" />
                                  <p className="text-sm font-black uppercase text-blue-600">{isI2VSelected ? ui("프레임 생성 중...", "Drawing Frame...") : ui("페이지 생성 중...", "Drawing Panels...")}</p>
                                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase">
                                    {ui("렌더링", "Rendering")} {seriesPlan?.series_spec.series.language === "en" ? "English" : "Hangul"}
                                  </p>
                                </div>
	                              ) : (
	                                <div className="flex flex-col items-center gap-3">
	                                  {pageError ? (
	                                    <div className="border-2 border-red-500 bg-red-50 p-3 text-left">
	                                      <p className="text-[10px] font-black uppercase text-red-700 flex items-center gap-2">
	                                        <AlertTriangle size={12} /> {ui("생성 실패", "Generation failed")}
	                                      </p>
	                                      <p className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] font-bold text-slate-700">{pageError}</p>
	                                    </div>
	                                  ) : null}
	                                  <button
	                                    onClick={() => generatePage(p.page.index)}
	                                    disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
	                                    className={`px-8 py-4 border-4 border-black font-black uppercase italic shadow-lg transition-transform ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-300 text-slate-600 cursor-not-allowed" : pageError ? "bg-red-600 text-white hover:bg-red-700" : "bg-blue-600 text-white hover:scale-110"
	                                      }`}
	                                  >
	                                    {autoGeneratePages ? ui("자동 대기 중...", "Auto Queue...") : pageError ? ui("다시 생성", "Retry") : isI2VSelected ? ui("프레임 생성", "Generate Frame") : ui("페이지 생성", "Generate Page")}
	                                  </button>
	                                  {pageError && nextAfterFailedPage ? (
	                                    <button
	                                      type="button"
	                                      onClick={() => generatePage(nextAfterFailedPage.page.index)}
	                                      disabled={Boolean(isProcessingPageIndex) || autoGeneratePages}
	                                      className={`px-4 py-2 border-2 border-black text-[10px] font-black uppercase ${Boolean(isProcessingPageIndex) || autoGeneratePages ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-white hover:bg-slate-100"}`}
	                                    >
	                                      {ui("건너뛰고 다음", "Skip to next")} {unitLabel} {nextAfterFailedPage.page.index}
	                                    </button>
	                                  ) : null}
	                                </div>
	                              )}
	                            </div>
	                          )}
                        </div>
                        <div className={`p-4 border-t-2 border-black bg-slate-50 ${showNarrativeText ? "" : "min-h-[80px]"}`}>
                          <p className="text-xs font-bold leading-tight line-clamp-3 italic text-slate-700">"{p.page.chapter_title}"</p>
                          {showNarrativeText ? (
                            <div className="mt-3">
                              <PageNarrativePreview page={p} compact uiLanguage={uiLanguage} />
                            </div>
                          ) : null}
                          {klingPromptPack ? (
                            <div className="mt-3 border-2 border-black bg-white p-3 space-y-2">
                              <p className="text-[10px] font-black uppercase text-blue-700">Kling 3.0 Prompt Pack</p>
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[9px] font-black uppercase text-slate-600">Prompt</p>
                                  <button
                                    type="button"
                                    onClick={() => copyText(klingPromptPack.prompt)}
                                    className="text-[9px] font-black uppercase border-2 border-black px-2 py-0.5 bg-white hover:bg-yellow-50 flex items-center gap-1"
                                  >
                                    <Copy size={10} /> {ui("프롬프트 복사", "Copy Prompt")}
                                  </button>
                                </div>
                                <textarea
                                  readOnly
                                  value={klingPromptPack.prompt}
                                  className="w-full border-2 border-black p-2 text-[10px] font-mono bg-white h-28 resize-y"
                                />
                              </div>
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[9px] font-black uppercase text-slate-600">Negative Prompt</p>
                                  <button
                                    type="button"
                                    onClick={() => copyText(klingPromptPack.negativePrompt)}
                                    className="text-[9px] font-black uppercase border-2 border-black px-2 py-0.5 bg-white hover:bg-yellow-50 flex items-center gap-1"
                                  >
                                    <Copy size={10} /> {ui("네거티브 복사", "Copy Negative")}
                                  </button>
                                </div>
                                <textarea
                                  readOnly
                                  value={klingPromptPack.negativePrompt}
                                  className="w-full border-2 border-black p-2 text-[10px] font-mono bg-white h-20 resize-y"
                                />
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase text-slate-600 mb-1">{ui("Kling 적용방법", "How to Use in Kling")}</p>
                                <textarea
                                  readOnly
                                  value={klingPromptPack.settingsHint}
                                  className="w-full border-2 border-black p-2 text-[10px] font-mono bg-slate-50 h-24 resize-y"
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {seriesPlan?.plan_meta.grounding_sources && seriesPlan.plan_meta.grounding_sources.length > 0 && (
              <div className="bg-white border-4 border-black p-6 md:p-8 comic-shadow">
                <h4 className="text-lg font-black uppercase mb-6 flex items-center gap-3">
                  <Globe className="text-blue-600" /> {ui("참고 자료", "References")}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {seriesPlan.plan_meta.grounding_sources.map((s, idx) => (
                    <a key={idx} href={s.uri} target="_blank" rel="noopener noreferrer" className="flex flex-col p-4 bg-slate-50 border-2 border-slate-100 hover:border-black transition-all">
                      <span className="text-xs font-black text-gray-800 line-clamp-1 mb-1">{s.title}</span>
                      <span className="text-[9px] text-blue-500 underline truncate">{s.uri}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {status === AppStatus.ERROR && (
          <div className="bg-red-50 border-4 border-red-500 p-8 md:p-12 text-center max-w-lg mx-auto">
            <div className="flex justify-start mb-4">
              <PreviousStepButton />
            </div>
            <h2 className="text-xl md:text-2xl font-black text-red-600 uppercase mb-4">{ui("시스템 오류", "System Failure")}</h2>
            <p className="text-sm font-bold mb-8">{ui("주제를 더 구체적으로 적거나 다른 스타일을 시도해봐.", "Try a more specific topic or a different style.")}</p>
            {systemError && (
              <pre className="text-left text-[10px] whitespace-pre-wrap bg-white border-2 border-red-400 p-3 mb-6 overflow-auto max-h-48">{systemError}</pre>
            )}
            <button onClick={() => setStatus(AppStatus.STYLE_SELECT)} className="bg-black text-white px-10 py-4 font-black">{ui("다시 시도", "Retry")}</button>
          </div>
        )}
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #000; border-radius: 2px; }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.5s ease-out forwards; }
      `}</style>
    </div>
  );
};

export default App;
