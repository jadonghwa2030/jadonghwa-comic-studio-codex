
export type Language = "ko" | "en";
export type AudienceLevel = "kids" | "teen" | "beginner" | "intermediate" | "expert";
export type TextStrategy = "embed_in_image" | "blank_bubbles_then_overlay";
export type LayoutVariety = "low" | "medium" | "high";
export type ImageSize = "1K" | "2K" | "4K";
export type NarrativeRole = "narrator" | "actor";
export type ResearchMode = "auto_gemini" | "auto_digest" | "user";
export type QuestionType = "explain" | "compare" | "review";
export type ComicMode = "learning" | "cinematic" | "pure_cinematic";
/** @deprecated Use PublicationFormat instead */
export type OutputMode = "comic" | "kling_i2v";
export type PublicationFormat = "learning_comic" | "webtoon" | "manga" | "kling_i2v";
export type MangaColorMode = "bw" | "color";
export type I2VAspectRatio = "16:9" | "9:16" | "1:1";
export type ToneMode = "normal" | "gag";
export type ToneLevel = "low" | "medium" | "high";
export type GeminiReasoningEffort = "low" | "medium" | "high";
export type ImageProvider = "codex";
export type CodexImageQuality = "low" | "medium" | "high";
export type ScriptDetail = "brief" | "normal" | "detailed";
export type PageCountMode = "auto" | "manual";
export type IntroStyle = "standard" | "myth_busting";
export type CastRole = "protagonist" | "supporting";
export type CatchphraseFrequency = "rare" | "sometimes" | "often";
export type CharacterConsistencyMode = "loose" | "strict";

export type CreationType = "educational" | "story" | "paper";
export type StoryInputType = "script" | "prose" | "scenario";
export type StoryAdaptationMode = "analyzed" | "direct";
export type AgeRating = "all_ages" | "teen" | "mature";
export type StoryGenre = "action" | "romance" | "horror" | "comedy" | "drama" | "fantasy" | "sci_fi" | "slice_of_life" | "mystery";
export type PacingPreference = "fast" | "balanced" | "slow";
export type PaperModeTrack = "public_summary" | "methodology_focus";

export type DeliveryStyleId =
  | "standard"
  | "community"
  | "friendly_banmal"
  | "elder"
  | "half_honorific"
  | "military"
  | "kindergarten_teacher"
  | "custom";

export interface DeliveryStyleSpec {
  preset_id: DeliveryStyleId;
  preset_label: string;
  instruction: string;
}

export interface DeliveryStylePreset {
  id: DeliveryStyleId;
  label: string;
  instruction: string;
  recommended_audience?: AudienceLevel[];
  unsafe_for_audience?: AudienceLevel[];
}

export enum AppStatus {
  IDLE = "IDLE",
  CHARACTER_SELECT = "CHARACTER_SELECT",
  STYLE_SELECT = "STYLE_SELECT",
  ANCHOR_BUILDING = "ANCHOR_BUILDING",
  TOPIC_INPUT = "TOPIC_INPUT",
  PLANNING = "PLANNING",
  PLAN_REVIEW = "PLAN_REVIEW",
  READY_TO_GENERATE = "READY_TO_GENERATE",
  GENERATING_PANELS = "GENERATING_PANELS",
  COMPOSING_PAGES = "COMPOSING_PAGES",
  COMPLETED = "COMPLETED",
  ERROR = "ERROR"
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface PlannerDebugChunk {
  start_index: number;
  end_index: number;
  include_plan_meta: boolean;
  enable_search: boolean;
  contents_with_research: string;
  contents_without_research: string;
  response_json: any;
}

export interface PlannerDebugInfo {
  model: string;
  provider?: "codex" | "gemini";
  max_output_tokens: number;
  reasoning_effort?: GeminiReasoningEffort;
  created_at: number;
  system_instruction: string;
  outline?: any;
  chunks: PlannerDebugChunk[];
  webtoon_pattern_selection?: any[];
}

export interface PageOutlineEntry {
  page_number: number;
  sub_topic: string;
  content_summary: string;
  narrative_function: string;
  connection_to_previous: string;
  learning_action?: string;
  reader_question?: string;
  opening_scene?: string;
  page_reveal?: string;
  dialogue_goal?: string;
  page_speech_flow?: string;
  dont_explain_yet?: string;
  allowed_content?: string[];
  forbidden_content?: string[];
  next_page_tease?: string;
  density_note?: string;
}

export interface PlanOutline {
  series_title: string;
  core_insight: string;
  rationale: string;
  page_outlines: PageOutlineEntry[];
}

export interface ResearchPack {
  notes: string;
  sources?: GroundingSource[];
  page_suggestions?: Record<ScriptDetail, number>;
}

export interface PaperStoryUnit {
  step: string;
  reader_question: string;
  opening_scene: string;
  page_reveal: string;
  page_speech_flow?: string;
  dont_explain_yet: string;
  allowed_content?: string[];
  forbidden_content?: string[];
  next_page_tease?: string;
  source_cue?: string;
}

export interface PaperBrief {
  paper_title: string;
  domain_guess: string;
  paper_mode_track: PaperModeTrack;
  one_line_takeaway: string;
  explainer_story: string;
  page_division_note: string;
  motivation_context: string;
  reader_hook_example: string;
  core_problem: string;
  research_question: string;
  prior_limitations: string[];
  main_contributions: string[];
  method_summary: string;
  result_summary: string;
  limitations: string[];
  public_reception_notes: string[];
  source_cues: string[];
  warnings: string[];
  page_suggestions: Record<ScriptDetail, number>;
}

export interface StylePreset {
  id: string;
  label: string;
  render_mode: "illustration" | "photoreal" | "mixed";
  style_prompt: string;
  negative_style_prompt: string;
  preview_hint: string;
  category?: string;
}

export interface LayoutTemplate {
  id: string;
  label: string;
  variety_tier: LayoutVariety;
  canvas: { w: number; h: number };
  panels: Array<{
    panel_index: number;
    shape: "rect" | "poly";
    rect?: { x: number; y: number; w: number; h: number };
    poly?: number[][];
    z: number;
    target_aspect_ratio: string;
    decor?: { shadow?: boolean; border_px?: number };
  }>;
}

// ── Webtoon Dynamic Layout ──
export type WebtoonSceneType = "dialogue" | "action" | "emotional" | "establishing" | "transition" | "impact" | "closeup";
export const WEBTOON_CORE_PATTERNS = [
  "stack_focus",
  "hero_drop",
  "split_row",
  "stair_step",
  "closeup_pulse",
  "impact_tail",
  "vertical_panorama",
  "void_reveal",
  "continuity_chain",
  "motion_runway",
  "one_point_charge",
] as const;
export type WebtoonCorePattern = typeof WEBTOON_CORE_PATTERNS[number];

export const WEBTOON_LAYOUT_MODIFIERS = [
  "borderless_open",
  "inset_closeup",
  "diagonal_cut",
  "overlap_bleed",
  "long_pause_gap",
  "micro_reaction",
] as const;
export type WebtoonLayoutModifier = typeof WEBTOON_LAYOUT_MODIFIERS[number];

export const WEBTOON_GAP_PROFILES = ["tight", "balanced", "breathing", "dramatic"] as const;
export type WebtoonGapProfile = typeof WEBTOON_GAP_PROFILES[number];
export type WebtoonScrollSegmentRole = "intro" | "beat" | "pause" | "climax" | "outro";

export const WEBTOON_SCROLL_CHOREOGRAPHY_PATTERNS = [
  "dialogue_air",
  "emotional_pause_reveal",
  "action_runway",
  "vertical_panorama",
  "micro_reaction_chain",
  "impact_drop",
] as const;
export type WebtoonScrollChoreographyPattern = typeof WEBTOON_SCROLL_CHOREOGRAPHY_PATTERNS[number];

export const WEBTOON_SCROLL_BEAT_KINDS = [
  "panel",
  "pause_space",
  "bubble_space",
  "borderless_scene",
  "reaction_micro",
  "impact_panel",
  "transition_air",
] as const;
export type WebtoonScrollBeatKind = typeof WEBTOON_SCROLL_BEAT_KINDS[number];

export const WEBTOON_SCROLL_FRAMINGS = [
  "wide",
  "portrait",
  "closeup",
  "full_body",
  "environment",
] as const;
export type WebtoonScrollFraming = typeof WEBTOON_SCROLL_FRAMINGS[number];

export const WEBTOON_SCROLL_WIDTH_PROFILES = ["full", "wide", "medium", "narrow", "tiny"] as const;
export type WebtoonScrollWidthProfile = typeof WEBTOON_SCROLL_WIDTH_PROFILES[number];

export const WEBTOON_SCROLL_X_POSITIONS = ["left", "center", "right", "drift"] as const;
export type WebtoonScrollXPosition = typeof WEBTOON_SCROLL_X_POSITIONS[number];

export const WEBTOON_SCROLL_SHAPE_STYLES = ["rect", "soft_border", "borderless", "diagonal", "inset", "overlap"] as const;
export type WebtoonScrollShapeStyle = typeof WEBTOON_SCROLL_SHAPE_STYLES[number];

export const WEBTOON_SCROLL_VERTICAL_ROLES = ["tap", "pause", "drop", "rush", "reveal"] as const;
export type WebtoonScrollVerticalRole = typeof WEBTOON_SCROLL_VERTICAL_ROLES[number];

export const WEBTOON_SCROLL_DISTANCES = ["short", "medium", "long", "very_long"] as const;
export type WebtoonScrollDistance = typeof WEBTOON_SCROLL_DISTANCES[number];

export interface WebtoonDynamicPanel {
  scene_type: WebtoonSceneType;
  height_weight: number; // 1~5 정수 가중치
}

export interface WebtoonDynamicLayout {
  panel_count: number; // 2~5
  panels: WebtoonDynamicPanel[];
  core_pattern: WebtoonCorePattern;
  modifiers: WebtoonLayoutModifier[];
  gap_profile: WebtoonGapProfile;
  focus_panel_index: number;
}

export interface WebtoonScrollBeat {
  kind: WebtoonScrollBeatKind;
  height_weight: number;
  visual_intent: string;
  text_intent?: string;
  framing?: WebtoonScrollFraming;
  width_profile?: WebtoonScrollWidthProfile;
  x_position?: WebtoonScrollXPosition;
  shape_style?: WebtoonScrollShapeStyle;
  vertical_role?: WebtoonScrollVerticalRole;
  scroll_distance?: WebtoonScrollDistance;
}

export interface WebtoonScrollChoreography {
  segment_index: number;
  canvas_size: "1024x3072";
  segment_role: WebtoonScrollSegmentRole;
  choreography_pattern: WebtoonScrollChoreographyPattern;
  beats: WebtoonScrollBeat[];
}

export type LearningLayoutRole =
  | "definition"
  | "comparison"
  | "process"
  | "reveal"
  | "quiz"
  | "summary"
  | "misconception"
  | "example"
  | "debate"
  | "investigation"
  | "timeline"
  | "cause_effect"
  | "cutaway"
  | "experiment";

export type LearningLayoutFlow =
  | "balanced_grid"
  | "top_to_bottom"
  | "left_right_compare"
  | "setup_to_punchline"
  | "zoom_in"
  | "hero_focus"
  | "action_diagonal"
  | "collision"
  | "evidence_stack"
  | "timeline_burst"
  | "cause_chain"
  | "cutaway_focus";

export type LearningLayoutDensity = "simple" | "balanced" | "dense";

export interface LearningLayoutIntent {
  role: LearningLayoutRole;
  focus_panel_index: number;
  visual_flow: LearningLayoutFlow;
  density: LearningLayoutDensity;
  template_reason: string;
}

export interface Beat {
  id: string;
  title: string;
  type: string;
  weight: number;
}

export interface PlanMeta {
  recommended_page_count: number;
  page_count_used: number;
  total_panels: number;
  detail_level: number;
  rationale_short: string;
  beats: Beat[];
  layout_variety: LayoutVariety;
  layout_history_used: string[];
  grounding_sources?: GroundingSource[];
}

export interface CharacterSpec {
  id: string;
  role: CastRole;
  name: string;
  appearance: string;
  analyzed_appearance?: string;
  persona?: string;
  catchphrase?: string;
  catchphrase_frequency?: CatchphraseFrequency;
  reference_images: string[];
  style_aligned_reference_images?: string[];
  style_aligned_reference_style_key?: string;
}

export interface SeriesSpec {
  series: {
    title: string;
    language: Language;
    audience_level: AudienceLevel;
    age_rating?: AgeRating;
    page_count: number;
  };
  anchors: {
    protagonist: {
      appearance: string;
      role: NarrativeRole;
      reference_images: {
        main: string;
        pack: string[];
      }
    };
    product?: {
      label: string;
      reference_images: string[];
    };
    tone_mode?: ToneMode;
    tone_level?: ToneLevel;
    cast?: CharacterSpec[];
    supporting_cast?: string;
    style: {
      preset_id: string;
      preset_label: string;
      style_prompt: string;
      negative_style_prompt: string;
      user_style_prompt: string | null;
      render_mode: "illustration" | "photoreal" | "mixed";
      style_reference_image?: string | null;
    };
    delivery?: DeliveryStyleSpec;
  };
  constraints: {
    comic_mode?: ComicMode;
    /** @deprecated Use publication_format instead */
    output_mode?: OutputMode;
    publication_format?: PublicationFormat;
    manga_color_mode?: MangaColorMode;
    i2v_aspect_ratio?: I2VAspectRatio;
    text_strategy: TextStrategy;
    layout_variety: LayoutVariety;
    image_size: ImageSize;
    image_provider?: ImageProvider;
    codex_image_quality?: CodexImageQuality;
    character_consistency_mode?: CharacterConsistencyMode;
    creation_type?: CreationType;
    story_input_type?: StoryInputType;
    story_adaptation_mode?: StoryAdaptationMode;
    story_genre?: StoryGenre;
    pacing?: PacingPreference;
    story_anti_education_guard?: boolean;
    paper_mode_track?: PaperModeTrack;
  };
}

export interface PanelSpec {
  index: number;
  scene: string;
  acting?: string;
  dialogues: string[];
  camera: string;
  mood: string;
  render: {
    target_aspect_ratio: string;
    safe_area_hint: string;
  };
}

export interface PageSpec {
  page: {
    index: number;
    chapter_title: string;
  };
  layout: {
    template_id: string;
    canvas: { w: number; h: number };
    gutter_px: number;
    border_px: number;
    border_radius_px: number;
    background_color: string;
    template_panels?: LayoutTemplate["panels"];
    learning_layout_intent?: LearningLayoutIntent;
    webtoon_layout?: WebtoonDynamicLayout;
    scroll_choreography?: WebtoonScrollChoreography;
    scroll?: {
      segment_role: WebtoonScrollSegmentRole;
      gap_after_px: number;
    };
  };
  panels: PanelSpec[];
}

export interface SeriesPlan {
  series_spec: SeriesSpec;
  pages: PageSpec[];
  plan_meta: any;
  debug?: PlannerDebugInfo;
}

export interface PanelResult {
  page_index: number;
  panel_index: number;
  raw_image_url: string;
}

export interface GenerationResult {
  page_index: number;
  composed_image_url: string;
}

export interface WebtoonEpisodeRenderResult {
  segment_urls: string[];
  source_page_indices: number[][];
  total_height_estimate: number;
}

export interface CharacterCandidate {
  image_id: string;
  preview_url: string;
}

export interface ImagePrompt {
  page_index: number;
  panel_index: number;
  prompt: string;
  negative_prompt: string;
  meta: {
    target_aspect_ratio: string;
    layout_template_id: string;
    style: any;
    character_reference_images: string[];
    image_size: ImageSize;
  };
}

export interface ComicPanel {
  panelId: number;
  narratorText: string;
  speechBubbleText: string;
  characterAction: string;
  imagePrompt: string;
}

export interface ComicStrip {
  title: string;
  panels: ComicPanel[];
}
