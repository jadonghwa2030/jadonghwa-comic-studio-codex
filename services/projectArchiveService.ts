import {
  AudienceLevel,
  CharacterConsistencyMode,
  CharacterSpec,
  ComicMode,
  CreationType,
  DeliveryStyleId,
  ImageSize,
  IntroStyle,
  I2VAspectRatio,
  ImageProvider,
  Language,
  LayoutVariety,
  MangaColorMode,
  NarrativeRole,
  GeminiReasoningEffort,
  CodexImageQuality,
  OutputMode,
  PaperBrief,
  PacingPreference,
  PaperModeTrack,
  PageCountMode,
  PublicationFormat,
  QuestionType,
  ResearchMode,
  ScriptDetail,
  SeriesPlan,
  SeriesSpec,
  StoryGenre,
  StoryInputType,
  ToneLevel,
  ToneMode,
  AgeRating
} from "../types";

export interface SavedComicProjectSnapshot {
  topic: string;
  questionType: QuestionType;
  comicMode: ComicMode;
  outputMode: OutputMode;
  publicationFormat?: PublicationFormat;
  mangaColorMode?: MangaColorMode;
  i2vAspectRatio: I2VAspectRatio;
  toneMode: ToneMode;
  toneLevel: ToneLevel;
  introStyle: IntroStyle;
  language: Language;
  audienceLevel: AudienceLevel;
  deliveryStyleId: DeliveryStyleId;
  deliveryCustomInstruction: string;
  geminiReasoningEffort: GeminiReasoningEffort;
  layoutVariety: LayoutVariety;
  imageSize: ImageSize;
  imageProvider?: ImageProvider;
  codexImageQuality?: CodexImageQuality;
  scriptDetail: ScriptDetail;
  pageCountMode: PageCountMode;
  targetPageCount: number;
  narrativeRole: NarrativeRole;
  characterConsistencyMode: CharacterConsistencyMode;
  useCrossPageStyleConsistency: boolean;
  researchMode: ResearchMode;
  researchDigestText: string;
  cast: CharacterSpec[];
  productReferenceImages: string[];
  selectedPresetId: string;
  selectedStyleCategory: string;
  finalStyle: SeriesSpec["anchors"]["style"] | null;
  seriesPlan: SeriesPlan;
  pageScriptEditedAt: Record<number, number>;
  pageStyleOverrides: Record<number, SeriesSpec["anchors"]["style"]>;
  pageStyleEditedAt: Record<number, number>;
  globalStyleEditedAt: number;
  creationType?: CreationType;
  scriptText?: string;
  storyInputType?: StoryInputType;
  ageRating?: AgeRating;
  storyGenre?: StoryGenre | null;
  pacingPreference?: PacingPreference;
  storyAntiEducationGuardEnabled?: boolean;
  storyDigestText?: string;
  paperBrief?: PaperBrief | null;
}

export interface SavedComicProject {
  id: string;
  label: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  snapshot: SavedComicProjectSnapshot;
}

const STORAGE_KEY = "toon-for-codex.project_archive.v1";

const hasLocalStorage = (): boolean => {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
};

const asNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const TEMPLATE_ID_ALIASES: Record<string, string> = {
  webtoon_hero_pair: "webtoon_hero_stack",
};

const migrateTemplateId = (templateId: unknown): string => {
  const current = typeof templateId === "string" ? templateId : "";
  if (!current) return "";
  return TEMPLATE_ID_ALIASES[current] || current;
};

const migrateSeriesPlanTemplateIds = (plan: SeriesPlan): SeriesPlan => {
  if (!Array.isArray(plan.pages) || plan.pages.length === 0) return plan;

  return {
    ...plan,
    pages: plan.pages.map((page) => ({
      ...page,
      layout: {
        ...page.layout,
        template_id: migrateTemplateId(page.layout?.template_id),
      },
    })),
  };
};

const compactSeriesPlanForStorage = (value: unknown): SeriesPlan | null => {
  if (!value || typeof value !== "object") return null;
  try {
    const next = JSON.parse(JSON.stringify(value)) as SeriesPlan;
    if ((next as any).debug) delete (next as any).debug;
    return migrateSeriesPlanTemplateIds(next);
  } catch {
    return null;
  }
};

const isQuestionType = (v: unknown): v is QuestionType =>
  v === "explain" || v === "compare" || v === "review";
const isComicMode = (v: unknown): v is ComicMode =>
  v === "learning" || v === "cinematic" || v === "pure_cinematic";
const isOutputMode = (v: unknown): v is OutputMode => v === "comic" || v === "kling_i2v";
const isPublicationFormat = (v: unknown): v is PublicationFormat =>
  v === "learning_comic" || v === "webtoon" || v === "manga" || v === "kling_i2v";
const isMangaColorMode = (v: unknown): v is MangaColorMode => v === "bw" || v === "color";
const isI2VAspectRatio = (v: unknown): v is I2VAspectRatio =>
  v === "16:9" || v === "9:16" || v === "1:1";
const isToneMode = (v: unknown): v is ToneMode => v === "normal" || v === "gag";
const isToneLevel = (v: unknown): v is ToneLevel => v === "low" || v === "medium" || v === "high";
const isIntroStyle = (v: unknown): v is IntroStyle => v === "standard" || v === "myth_busting";
const isLanguage = (v: unknown): v is Language => v === "ko" || v === "en";
const isAudienceLevel = (v: unknown): v is AudienceLevel =>
  v === "kids" || v === "teen" || v === "beginner" || v === "intermediate" || v === "expert";
const isDeliveryStyleId = (v: unknown): v is DeliveryStyleId =>
  v === "standard" ||
  v === "community" ||
  v === "friendly_banmal" ||
  v === "elder" ||
  v === "half_honorific" ||
  v === "military" ||
  v === "marine_literature" ||
  v === "strict_teacher" ||
  v === "kindergarten_teacher" ||
  v === "sensual_pg13" ||
  v === "korean_american" ||
  v === "custom";
const isLayoutVariety = (v: unknown): v is LayoutVariety => v === "low" || v === "medium" || v === "high";
const isImageSize = (v: unknown): v is ImageSize => v === "1K" || v === "2K" || v === "4K";
const isImageProvider = (v: unknown): v is ImageProvider => v === "codex";
const isCodexImageQuality = (v: unknown): v is CodexImageQuality =>
  v === "low" || v === "medium" || v === "high";
const isScriptDetail = (v: unknown): v is ScriptDetail => v === "brief" || v === "normal" || v === "detailed";
const isPageCountMode = (v: unknown): v is PageCountMode => v === "auto" || v === "manual";
const isNarrativeRole = (v: unknown): v is NarrativeRole => v === "narrator" || v === "actor";
const isCharacterConsistencyMode = (v: unknown): v is CharacterConsistencyMode => v === "loose" || v === "strict";
const isResearchMode = (v: unknown): v is ResearchMode =>
  v === "user" || v === "auto_gemini" || v === "auto_digest";
const isCreationType = (v: unknown): v is CreationType =>
  v === "educational" || v === "story" || v === "paper";
const isStoryInputType = (v: unknown): v is StoryInputType =>
  v === "script" || v === "prose" || v === "scenario";
const isAgeRating = (v: unknown): v is AgeRating =>
  v === "all_ages" || v === "teen" || v === "mature";
const isStoryGenre = (v: unknown): v is StoryGenre =>
  v === "action" || v === "romance" || v === "horror" || v === "comedy" || v === "drama" || v === "fantasy" || v === "sci_fi" || v === "slice_of_life" || v === "mystery";
const isPacingPreference = (v: unknown): v is PacingPreference =>
  v === "fast" || v === "balanced" || v === "slow";
const isPaperModeTrack = (v: unknown): v is PaperModeTrack =>
  v === "public_summary" || v === "methodology_focus";

const asNumberRecord = (value: unknown): Record<number, number> => {
  if (!value || typeof value !== "object") return {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = Number.parseInt(k, 10);
    if (!Number.isFinite(key)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
};

const asStyleOverrideRecord = (
  value: unknown
): Record<number, SeriesSpec["anchors"]["style"]> => {
  if (!value || typeof value !== "object") return {};
  const out: Record<number, SeriesSpec["anchors"]["style"]> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = Number.parseInt(k, 10);
    if (!Number.isFinite(key)) continue;
    if (!v || typeof v !== "object") continue;
    out[key] = v as SeriesSpec["anchors"]["style"];
  }
  return out;
};

const sanitizePaperBrief = (value: unknown): PaperBrief | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const toStrings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
  const toPaperStoryUnits = (input: unknown): PaperBrief["paper_story_units"] =>
    Array.isArray(input)
      ? input
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          step: typeof item.step === "string" ? item.step : "",
          reader_question: typeof item.reader_question === "string" ? item.reader_question : "",
          opening_scene: typeof item.opening_scene === "string" ? item.opening_scene : "",
          page_reveal: typeof item.page_reveal === "string" ? item.page_reveal : "",
          page_speech_flow: typeof item.page_speech_flow === "string" ? item.page_speech_flow : "",
          dont_explain_yet: typeof item.dont_explain_yet === "string" ? item.dont_explain_yet : "",
          allowed_content: toStrings(item.allowed_content),
          forbidden_content: toStrings(item.forbidden_content),
          next_page_tease: typeof item.next_page_tease === "string" ? item.next_page_tease : "",
          source_cue: typeof item.source_cue === "string" ? item.source_cue : ""
        }))
      : [];

  return {
    paper_title: typeof raw.paper_title === "string" ? raw.paper_title : "",
    domain_guess: typeof raw.domain_guess === "string" ? raw.domain_guess : "",
    paper_mode_track: isPaperModeTrack(raw.paper_mode_track) ? raw.paper_mode_track : "public_summary",
    one_line_takeaway: typeof raw.one_line_takeaway === "string" ? raw.one_line_takeaway : "",
    motivation_context: typeof raw.motivation_context === "string" ? raw.motivation_context : "",
    reader_hook_example: typeof raw.reader_hook_example === "string" ? raw.reader_hook_example : "",
    opening_candidates: toStrings(raw.opening_candidates),
    paper_story_units: toPaperStoryUnits(raw.paper_story_units),
    page_budget_note: typeof raw.page_budget_note === "string" ? raw.page_budget_note : "",
    core_problem: typeof raw.core_problem === "string" ? raw.core_problem : "",
    research_question: typeof raw.research_question === "string" ? raw.research_question : "",
    prior_limitations: toStrings(raw.prior_limitations),
    main_contributions: toStrings(raw.main_contributions),
    method_summary: typeof raw.method_summary === "string" ? raw.method_summary : "",
    result_summary: typeof raw.result_summary === "string" ? raw.result_summary : "",
    limitations: toStrings(raw.limitations),
    source_cues: toStrings(raw.source_cues),
    warnings: toStrings(raw.warnings),
    page_suggestions: {
      brief: Math.max(1, Math.floor(asNumber((raw.page_suggestions as any)?.brief, 1))),
      normal: Math.max(1, Math.floor(asNumber((raw.page_suggestions as any)?.normal, 2))),
      detailed: Math.max(1, Math.floor(asNumber((raw.page_suggestions as any)?.detailed, 3)))
    }
  };
};

const sanitizeSnapshot = (raw: any): SavedComicProjectSnapshot | null => {
  if (!raw || typeof raw !== "object") return null;
  const compactedSeriesPlan = compactSeriesPlanForStorage(raw.seriesPlan);
  if (!compactedSeriesPlan) return null;

  return {
    topic: typeof raw.topic === "string" ? raw.topic : "",
    questionType: isQuestionType(raw.questionType) ? raw.questionType : "explain",
    comicMode: isComicMode(raw.comicMode) ? raw.comicMode : "learning",
    outputMode: isOutputMode(raw.outputMode) ? raw.outputMode : "comic",
    publicationFormat: isPublicationFormat(raw.publicationFormat)
      ? raw.publicationFormat
      : (raw.outputMode === "kling_i2v" ? "kling_i2v" : "learning_comic"),
    mangaColorMode: isMangaColorMode(raw.mangaColorMode) ? raw.mangaColorMode : "bw",
    i2vAspectRatio: isI2VAspectRatio(raw.i2vAspectRatio) ? raw.i2vAspectRatio : "16:9",
    toneMode: isToneMode(raw.toneMode) ? raw.toneMode : "normal",
    toneLevel: isToneLevel(raw.toneLevel) ? raw.toneLevel : "medium",
    introStyle: isIntroStyle(raw.introStyle) ? raw.introStyle : "standard",
    language: isLanguage(raw.language) ? raw.language : "ko",
    audienceLevel: isAudienceLevel(raw.audienceLevel) ? raw.audienceLevel : "beginner",
    deliveryStyleId: isDeliveryStyleId(raw.deliveryStyleId) ? raw.deliveryStyleId : "standard",
    deliveryCustomInstruction:
      typeof raw.deliveryCustomInstruction === "string" ? raw.deliveryCustomInstruction : "",
    geminiReasoningEffort:
      raw.geminiReasoningEffort === "low" || raw.geminiReasoningEffort === "high"
        ? raw.geminiReasoningEffort
        : "medium",
    layoutVariety: isLayoutVariety(raw.layoutVariety) ? raw.layoutVariety : "high",
    imageSize: isImageSize(raw.imageSize) ? raw.imageSize : "1K",
    imageProvider: isImageProvider(raw.imageProvider) ? raw.imageProvider : "codex",
    codexImageQuality: isCodexImageQuality(raw.codexImageQuality)
      ? raw.codexImageQuality
      : isCodexImageQuality(raw.openAiImageQuality)
        ? raw.openAiImageQuality
        : "medium",
    scriptDetail: isScriptDetail(raw.scriptDetail) ? raw.scriptDetail : "normal",
    pageCountMode: isPageCountMode(raw.pageCountMode) ? raw.pageCountMode : "auto",
    targetPageCount: Math.max(1, Math.floor(asNumber(raw.targetPageCount, 2))),
    narrativeRole: isNarrativeRole(raw.narrativeRole) ? raw.narrativeRole : "narrator",
    characterConsistencyMode: isCharacterConsistencyMode(raw.characterConsistencyMode)
      ? raw.characterConsistencyMode
      : "loose",
    useCrossPageStyleConsistency: raw.useCrossPageStyleConsistency !== false,
    researchMode: isResearchMode(raw.researchMode) ? raw.researchMode : "user",
    researchDigestText: typeof raw.researchDigestText === "string" ? raw.researchDigestText : "",
    cast: Array.isArray(raw.cast) ? (raw.cast as CharacterSpec[]) : [],
    productReferenceImages: Array.isArray(raw.productReferenceImages)
      ? raw.productReferenceImages.filter((v: unknown): v is string => typeof v === "string")
      : [],
    selectedPresetId:
      typeof raw.selectedPresetId === "string" ? raw.selectedPresetId : "kwebtoon_clean_pastel",
    selectedStyleCategory: typeof raw.selectedStyleCategory === "string" ? raw.selectedStyleCategory : "Webtoon",
    finalStyle:
      raw.finalStyle && typeof raw.finalStyle === "object"
        ? (raw.finalStyle as SeriesSpec["anchors"]["style"])
        : null,
    seriesPlan: compactedSeriesPlan,
    pageScriptEditedAt: asNumberRecord(raw.pageScriptEditedAt),
    pageStyleOverrides: asStyleOverrideRecord(raw.pageStyleOverrides),
    pageStyleEditedAt: asNumberRecord(raw.pageStyleEditedAt),
    globalStyleEditedAt: asNumber(raw.globalStyleEditedAt, 0),
    creationType: isCreationType(raw.creationType) ? raw.creationType : "educational",
    scriptText: typeof raw.scriptText === "string" ? raw.scriptText : "",
    storyInputType: isStoryInputType(raw.storyInputType) ? raw.storyInputType : "scenario",
    ageRating: isAgeRating(raw.ageRating) ? raw.ageRating : "teen",
    storyGenre: isStoryGenre(raw.storyGenre) ? raw.storyGenre : null,
    pacingPreference: isPacingPreference(raw.pacingPreference) ? raw.pacingPreference : "balanced",
    storyAntiEducationGuardEnabled: raw.storyAntiEducationGuardEnabled !== false,
    storyDigestText: typeof raw.storyDigestText === "string" ? raw.storyDigestText : "",
    paperBrief: sanitizePaperBrief(raw.paperBrief)
  };
};

const sanitizeSavedProject = (raw: any): SavedComicProject | null => {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  const snapshot = sanitizeSnapshot(raw.snapshot);
  if (!snapshot) return null;
  const created_at = asNumber(raw.created_at, Date.now());
  const updated_at = asNumber(raw.updated_at, created_at);
  const last_opened_at = asNumber(raw.last_opened_at, updated_at);
  return {
    id: raw.id,
    label: raw.label,
    created_at,
    updated_at,
    last_opened_at,
    snapshot
  };
};

export const loadSavedComicProjects = (): SavedComicProject[] => {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSavedProject)
      .filter((p): p is SavedComicProject => Boolean(p))
      .sort((a, b) => b.updated_at - a.updated_at);
  } catch {
    return [];
  }
};

export const persistSavedComicProjects = (projects: SavedComicProject[]): void => {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.warn("Failed to persist saved comic projects:", e);
  }
};
