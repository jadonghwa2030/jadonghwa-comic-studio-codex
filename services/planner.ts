
import { Type } from "./schemaTypes";
import { SeriesSpec, PageSpec, Language, AudienceLevel, NarrativeRole, LayoutVariety, LayoutTemplate, ImageSize, GroundingSource, ResearchMode, ResearchPack, QuestionType, ScriptDetail, DeliveryStyleSpec, ComicMode, ToneMode, ToneLevel, IntroStyle, CharacterSpec, CharacterConsistencyMode, PlannerDebugChunk, PlannerDebugInfo, SeriesPlan, OutputMode, I2VAspectRatio, PlanOutline, PageOutlineEntry, PublicationFormat, MangaColorMode, StoryInputType, AgeRating, StoryGenre, PacingPreference, PaperBrief, GeminiReasoningEffort, LearningLayoutDensity, LearningLayoutFlow, LearningLayoutIntent, LearningLayoutRole, WEBTOON_CORE_PATTERNS, WEBTOON_GAP_PROFILES, WEBTOON_LAYOUT_MODIFIERS, WEBTOON_SCROLL_BEAT_KINDS, WEBTOON_SCROLL_CHOREOGRAPHY_PATTERNS, WEBTOON_SCROLL_DISTANCES, WEBTOON_SCROLL_FRAMINGS, WEBTOON_SCROLL_SHAPE_STYLES, WEBTOON_SCROLL_VERTICAL_ROLES, WEBTOON_SCROLL_WIDTH_PROFILES, WEBTOON_SCROLL_X_POSITIONS, WebtoonCorePattern, WebtoonDynamicLayout, WebtoonScrollBeatKind, WebtoonScrollChoreography, WebtoonScrollChoreographyPattern, WebtoonScrollDistance, WebtoonScrollFraming, WebtoonScrollSegmentRole, WebtoonScrollShapeStyle, WebtoonScrollVerticalRole, WebtoonScrollWidthProfile, WebtoonScrollXPosition } from "../types";
import { postJson } from "./localApi";
import { parseDynamicLayout, buildDynamicWebtoonTemplate } from "./webtoonLayoutBuilder";
import { DEFAULT_WEBTOON_PATTERN_CANDIDATES, chooseBestPattern, inferFocusPanelIndexForPattern, inferGapProfileForPattern } from "./webtoonPatternScoring";

const WEBTOON_CORE_PATTERN_DOC = WEBTOON_CORE_PATTERNS.join("|");
const WEBTOON_MODIFIER_DOC = WEBTOON_LAYOUT_MODIFIERS.join("|");
const WEBTOON_GAP_PROFILE_DOC = WEBTOON_GAP_PROFILES.join("|");
const WEBTOON_SCROLL_PATTERN_DOC = WEBTOON_SCROLL_CHOREOGRAPHY_PATTERNS.join("|");
const WEBTOON_SCROLL_BEAT_KIND_DOC = WEBTOON_SCROLL_BEAT_KINDS.join("|");
const WEBTOON_SCROLL_FRAMING_DOC = WEBTOON_SCROLL_FRAMINGS.join("|");
const WEBTOON_SCROLL_WIDTH_PROFILE_DOC = WEBTOON_SCROLL_WIDTH_PROFILES.join("|");
const WEBTOON_SCROLL_X_POSITION_DOC = WEBTOON_SCROLL_X_POSITIONS.join("|");
const WEBTOON_SCROLL_SHAPE_STYLE_DOC = WEBTOON_SCROLL_SHAPE_STYLES.join("|");
const WEBTOON_SCROLL_VERTICAL_ROLE_DOC = WEBTOON_SCROLL_VERTICAL_ROLES.join("|");
const WEBTOON_SCROLL_DISTANCE_DOC = WEBTOON_SCROLL_DISTANCES.join("|");
const LEARNING_LAYOUT_ROLES: LearningLayoutRole[] = [
  "definition",
  "comparison",
  "process",
  "reveal",
  "quiz",
  "summary",
  "misconception",
  "example",
  "debate",
  "investigation",
  "timeline",
  "cause_effect",
  "cutaway",
  "experiment",
];
const LEARNING_LAYOUT_FLOWS: LearningLayoutFlow[] = [
  "balanced_grid",
  "top_to_bottom",
  "left_right_compare",
  "setup_to_punchline",
  "zoom_in",
  "hero_focus",
  "action_diagonal",
  "collision",
  "evidence_stack",
  "timeline_burst",
  "cause_chain",
  "cutaway_focus",
];
const LEARNING_LAYOUT_DENSITIES: LearningLayoutDensity[] = ["simple", "balanced", "dense"];
const LEARNING_LAYOUT_ROLE_DOC = LEARNING_LAYOUT_ROLES.join("|");
const LEARNING_LAYOUT_FLOW_DOC = LEARNING_LAYOUT_FLOWS.join("|");
const LEARNING_LAYOUT_DENSITY_DOC = LEARNING_LAYOUT_DENSITIES.join("|");
const WEBTOON_STATIC_ANCHOR_TEMPLATE_IDS = [
  "webtoon_hero_stack",
  "webtoon_stack_3",
  "webtoon_stack_4",
  "webtoon_impact",
] as const;

const isWebtoonStaticAnchorTemplateId = (templateId: string): boolean =>
  WEBTOON_STATIC_ANCHOR_TEMPLATE_IDS.includes(templateId as typeof WEBTOON_STATIC_ANCHOR_TEMPLATE_IDS[number]);

const getWebtoonAnchorTemplateSummaries = (templates: LayoutTemplate[]) =>
  templates
    .filter((template) => isWebtoonStaticAnchorTemplateId(template.id))
    .map((template) => ({
      id: template.id,
      label: template.label,
      panels: template.panels.length,
      ratios: template.panels.map((panel) => panel.target_aspect_ratio),
    }));

const getWebtoonAnchorGuidance = (
  templateSummaries: Array<{ id: string; label: string; panels: number; ratios: string[] }>,
  pageCount: number
): string => {
  if (templateSummaries.length === 0) return "";

  const recommendedSlots = pageCount >= 8
    ? "권장 배치: 정적 앵커는 최대 2페이지 정도만 사용하세요. 정말 필요한 도입 1페이지, 마지막 임팩트 1페이지 정도면 충분합니다."
    : pageCount >= 5
      ? "권장 배치: 가능하면 마지막/클라이맥스 1페이지만 정적으로 쓰고, 도입도 동적 레이아웃으로 먼저 시도하세요."
      : "권장 배치: 정적 앵커 없이도 충분합니다. 꼭 필요할 때만 1페이지 정도 사용하세요.";

  return `
- 웹툰 전체에서 정적 앵커 템플릿(template_id)을 쓰는 페이지는 최대 2개까지만 허용하세요.
- 정적 앵커 페이지는 도입/호흡/클라이맥스 같은 강한 비트에만 사용하세요. 나머지 페이지는 webtoon_layout으로 동적으로 설계하세요.
- 정적 앵커 페이지를 선택했다면 template_id만 사용하고 webtoon_layout은 생략하세요.
- 동적 페이지를 선택했다면 webtoon_layout을 사용하고 template_id는 생략하세요.
- 정적 앵커 페이지의 panels 배열 길이는 선택한 템플릿의 컷 수와 정확히 같아야 합니다.
- 사용 가능한 정적 앵커 템플릿: ${JSON.stringify(templateSummaries)}
- ${recommendedSlots}`;
};

const MAX_WEBTOON_STATIC_ANCHOR_PAGES = 2;
const WEBTOON_PATTERN_OVERRIDE_MARGIN = 1.5;
const WEBTOON_PATTERN_REPEAT_ESCAPE_MARGIN = 1.0;
const LEARNING_LAYOUT_TEMPLATE_MAP: Record<LearningLayoutRole, string[]> = {
  definition: ["hero_top", "classic_grid", "quad_asymmetric"],
  comparison: ["quad_asymmetric", "masonry_alt", "classic_grid"],
  process: ["wide_strips", "sandwich", "hero_top"],
  reveal: ["hero_bottom", "inset_focus", "diagonal_split_v1"],
  quiz: ["hero_bottom", "diagonal_split_v1", "inset_focus"],
  summary: ["classic_grid", "sandwich", "hero_top"],
  misconception: ["diagonal_v2", "hero_bottom", "quad_asymmetric"],
  example: ["triptych_hero", "masonry_alt", "inset_focus"],
  debate: ["debate_collision_5", "myth_fact_split_5", "quad_asymmetric"],
  investigation: ["investigation_board_7", "zoom_cascade_5", "inset_focus"],
  timeline: ["timeline_burst_6", "wide_strips", "sandwich"],
  cause_effect: ["cause_effect_chain_6", "process_cutaway_6", "masonry_alt"],
  cutaway: ["process_cutaway_6", "cinematic_definition_3", "inset_focus"],
  experiment: ["experiment_failure_7", "investigation_board_7", "process_cutaway_6"],
};
const LEARNING_LAYOUT_FLOW_TEMPLATE_MAP: Record<LearningLayoutFlow, string[]> = {
  balanced_grid: ["classic_grid", "quad_asymmetric"],
  top_to_bottom: ["wide_strips", "sandwich", "hero_top"],
  left_right_compare: ["quad_asymmetric", "masonry_alt", "classic_grid"],
  setup_to_punchline: ["hero_bottom", "sandwich"],
  zoom_in: ["inset_focus", "triptych_hero"],
  hero_focus: ["hero_top", "triptych_hero", "hero_bottom"],
  action_diagonal: ["diagonal_v2", "diagonal_split_v1"],
  collision: ["debate_collision_5", "misconception_crack_5", "myth_fact_split_5"],
  evidence_stack: ["investigation_board_7", "zoom_cascade_5", "experiment_failure_7"],
  timeline_burst: ["timeline_burst_6", "cause_effect_chain_6"],
  cause_chain: ["cause_effect_chain_6", "process_cutaway_6"],
  cutaway_focus: ["process_cutaway_6", "cinematic_definition_3"],
};
const WEBTOON_GAP_PX_BY_PROFILE = {
  tight: 24,
  balanced: 48,
  breathing: 96,
  dramatic: 160,
} as const;

const getWebtoonSegmentRole = (pageNumber: number, totalPages: number): WebtoonScrollSegmentRole =>
  pageNumber <= 1
    ? "intro"
    : pageNumber >= totalPages
      ? "climax"
      : "beat";

const inferStaticWebtoonGapProfile = (templateId: string): keyof typeof WEBTOON_GAP_PX_BY_PROFILE => {
  if (templateId === "webtoon_impact") return "dramatic";
  if (templateId === "webtoon_stack_3") return "breathing";
  return "balanced";
};

const buildWebtoonScrollMeta = (
  page: {
    template_id?: string;
    webtoon_layout?: { gap_profile?: keyof typeof WEBTOON_GAP_PX_BY_PROFILE };
  },
  pageNumber: number,
  totalPages: number
) => {
  const gapProfile =
    page.webtoon_layout?.gap_profile ||
    inferStaticWebtoonGapProfile(String(page.template_id || ""));
  const gap_after_px = pageNumber >= totalPages
    ? 0
    : WEBTOON_GAP_PX_BY_PROFILE[gapProfile] || WEBTOON_GAP_PX_BY_PROFILE.balanced;
  const segment_role = getWebtoonSegmentRole(pageNumber, totalPages);

  return {
    segment_role,
    gap_after_px,
  };
};

const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const asLearningLayoutRole = (value: unknown, fallback: LearningLayoutRole): LearningLayoutRole =>
  LEARNING_LAYOUT_ROLES.includes(value as LearningLayoutRole)
    ? (value as LearningLayoutRole)
    : fallback;

const asLearningLayoutFlow = (value: unknown, fallback: LearningLayoutFlow): LearningLayoutFlow =>
  LEARNING_LAYOUT_FLOWS.includes(value as LearningLayoutFlow)
    ? (value as LearningLayoutFlow)
    : fallback;

const asLearningLayoutDensity = (value: unknown, fallback: LearningLayoutDensity): LearningLayoutDensity =>
  LEARNING_LAYOUT_DENSITIES.includes(value as LearningLayoutDensity)
    ? (value as LearningLayoutDensity)
    : fallback;

const normalizeLearningLayoutIntent = (raw: any): LearningLayoutIntent | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const role = asLearningLayoutRole(raw.role, "definition");
  const visualFlow = asLearningLayoutFlow(raw.visual_flow, "balanced_grid");
  const density = asLearningLayoutDensity(raw.density, "balanced");
  const focusPanelIndex = clampNumber(Math.round(Number(raw.focus_panel_index) || 4), 1, 7);
  const templateReason = String(raw.template_reason || "").trim() || "Select the layout that best matches this learning beat.";

  return {
    role,
    focus_panel_index: focusPanelIndex,
    visual_flow: visualFlow,
    density,
    template_reason: templateReason,
  };
};

const pickLearningTemplateByIntent = (
  intent: LearningLayoutIntent | undefined,
  templates: LayoutTemplate[],
  preferred: LayoutTemplate,
  recentTemplateIds: Set<string>
): LayoutTemplate => {
  if (!intent || templates.length === 0) return preferred;
  const byId = new Map(templates.map((template) => [template.id, template] as const));
  const densityCandidates =
    intent.density === "dense"
      ? ["investigation_board_7", "experiment_failure_7", "quiz_tension_6", "timeline_burst_6", "diagonal_v2", "diagonal_split_v1", "inset_focus", "masonry_alt", "quad_asymmetric"]
      : intent.density === "simple"
        ? ["cinematic_definition_3", "impact_reveal_3", "classic_grid", "hero_top", "wide_strips", "sandwich"]
        : ["debate_collision_5", "myth_fact_split_5", "zoom_cascade_5", "hero_bottom", "quad_asymmetric", "masonry_alt", "sandwich", "triptych_hero"];
  const focusCandidates =
    intent.focus_panel_index >= 6
      ? ["quiz_tension_6", "timeline_burst_6", "cause_effect_chain_6", "process_cutaway_6", "experiment_failure_7"]
      : intent.focus_panel_index === 5
        ? ["debate_collision_5", "misconception_crack_5", "myth_fact_split_5", "zoom_cascade_5"]
        : intent.focus_panel_index === 4
      ? ["hero_bottom", "sandwich", "inset_strip"]
      : intent.focus_panel_index === 1
        ? ["hero_top", "triptych_hero", "inset_focus"]
        : [];

  const candidateIds = [
    ...(LEARNING_LAYOUT_TEMPLATE_MAP[intent.role] || []),
    ...(LEARNING_LAYOUT_FLOW_TEMPLATE_MAP[intent.visual_flow] || []),
    ...focusCandidates,
    ...densityCandidates,
    preferred.id,
  ];
  const uniqueCandidates = Array.from(new Set(candidateIds))
    .map((id) => byId.get(id))
    .filter((template): template is LayoutTemplate => Boolean(template));

  return (
    uniqueCandidates.find((template) => !recentTemplateIds.has(template.id)) ||
    uniqueCandidates[0] ||
    preferred
  );
};

const getLearningTemplatePreferenceIds = (intent: LearningLayoutIntent | undefined, preferredId: string): string[] => {
  if (!intent) return [preferredId];
  const densityCandidates =
    intent.density === "dense"
      ? ["investigation_board_7", "experiment_failure_7", "quiz_tension_6", "timeline_burst_6", "diagonal_v2", "diagonal_split_v1", "inset_focus", "masonry_alt", "quad_asymmetric"]
      : intent.density === "simple"
        ? ["cinematic_definition_3", "impact_reveal_3", "classic_grid", "hero_top", "wide_strips", "sandwich"]
        : ["debate_collision_5", "myth_fact_split_5", "zoom_cascade_5", "hero_bottom", "quad_asymmetric", "masonry_alt", "sandwich", "triptych_hero"];
  const focusCandidates =
    intent.focus_panel_index >= 6
      ? ["quiz_tension_6", "timeline_burst_6", "cause_effect_chain_6", "process_cutaway_6", "experiment_failure_7"]
      : intent.focus_panel_index === 5
        ? ["debate_collision_5", "misconception_crack_5", "myth_fact_split_5", "zoom_cascade_5"]
        : intent.focus_panel_index === 4
          ? ["hero_bottom", "sandwich", "inset_strip"]
          : intent.focus_panel_index === 1
            ? ["hero_top", "triptych_hero", "inset_focus"]
            : [];

  return Array.from(new Set([
    ...(LEARNING_LAYOUT_TEMPLATE_MAP[intent.role] || []),
    ...(LEARNING_LAYOUT_FLOW_TEMPLATE_MAP[intent.visual_flow] || []),
    ...focusCandidates,
    ...densityCandidates,
    preferredId,
  ]));
};

const pickLearningTemplateByPanelCount = (
  templates: LayoutTemplate[],
  preferred: LayoutTemplate,
  panelCount: number,
  intent: LearningLayoutIntent | undefined,
  recentTemplateIds: Set<string>
): LayoutTemplate => {
  if (!Number.isFinite(panelCount) || panelCount <= 0) return preferred;
  if (preferred.panels.length === panelCount) return preferred;

  const exact = templates.filter((template) => template.panels.length === panelCount);
  const candidates = exact.length > 0
    ? exact
    : templates
      .filter((template) => template.panels.length >= 1)
      .sort((a, b) => {
        const diff = Math.abs(a.panels.length - panelCount) - Math.abs(b.panels.length - panelCount);
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 4);
  if (candidates.length === 0) return preferred;

  const preference = getLearningTemplatePreferenceIds(intent, preferred.id);
  const score = (template: LayoutTemplate) => {
    const preferenceIndex = preference.indexOf(template.id);
    const preferenceScore = preferenceIndex >= 0 ? preferenceIndex : 999;
    const recentPenalty = recentTemplateIds.has(template.id) ? 100 : 0;
    const distance = Math.abs(template.panels.length - panelCount) * 10;
    return preferenceScore + recentPenalty + distance;
  };

  return [...candidates].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  })[0] || preferred;
};

const asScrollPattern = (value: unknown, fallback: WebtoonScrollChoreographyPattern): WebtoonScrollChoreographyPattern =>
  WEBTOON_SCROLL_CHOREOGRAPHY_PATTERNS.includes(value as WebtoonScrollChoreographyPattern)
    ? (value as WebtoonScrollChoreographyPattern)
    : fallback;

const asScrollBeatKind = (value: unknown, fallback: WebtoonScrollBeatKind): WebtoonScrollBeatKind =>
  WEBTOON_SCROLL_BEAT_KINDS.includes(value as WebtoonScrollBeatKind)
    ? (value as WebtoonScrollBeatKind)
    : fallback;

const asScrollFraming = (value: unknown): WebtoonScrollFraming | undefined =>
  WEBTOON_SCROLL_FRAMINGS.includes(value as WebtoonScrollFraming)
    ? (value as WebtoonScrollFraming)
    : undefined;

const asScrollWidthProfile = (value: unknown): WebtoonScrollWidthProfile | undefined =>
  WEBTOON_SCROLL_WIDTH_PROFILES.includes(value as WebtoonScrollWidthProfile)
    ? (value as WebtoonScrollWidthProfile)
    : undefined;

const asScrollXPosition = (value: unknown): WebtoonScrollXPosition | undefined =>
  WEBTOON_SCROLL_X_POSITIONS.includes(value as WebtoonScrollXPosition)
    ? (value as WebtoonScrollXPosition)
    : undefined;

const asScrollShapeStyle = (value: unknown): WebtoonScrollShapeStyle | undefined =>
  WEBTOON_SCROLL_SHAPE_STYLES.includes(value as WebtoonScrollShapeStyle)
    ? (value as WebtoonScrollShapeStyle)
    : undefined;

const asScrollVerticalRole = (value: unknown): WebtoonScrollVerticalRole | undefined =>
  WEBTOON_SCROLL_VERTICAL_ROLES.includes(value as WebtoonScrollVerticalRole)
    ? (value as WebtoonScrollVerticalRole)
    : undefined;

const asScrollDistance = (value: unknown): WebtoonScrollDistance | undefined =>
  WEBTOON_SCROLL_DISTANCES.includes(value as WebtoonScrollDistance)
    ? (value as WebtoonScrollDistance)
    : undefined;

const inferScrollPatternFromLayout = (
  layout: WebtoonDynamicLayout | undefined,
  segmentRole: WebtoonScrollSegmentRole,
  narrativeFunction?: string
): WebtoonScrollChoreographyPattern => {
  if (segmentRole === "climax") return "impact_drop";
  if (layout?.core_pattern === "vertical_panorama") return "vertical_panorama";
  if (layout?.core_pattern === "motion_runway" || layout?.core_pattern === "one_point_charge") return "action_runway";
  if (layout?.core_pattern === "void_reveal" || layout?.modifiers.includes("long_pause_gap")) return "emotional_pause_reveal";
  if (layout?.core_pattern === "continuity_chain" || layout?.modifiers.includes("micro_reaction")) return "micro_reaction_chain";
  if (/climax|turning_point|resolution|emotional|reveal/i.test(String(narrativeFunction || ""))) return "emotional_pause_reveal";
  return "dialogue_air";
};

const defaultScrollBeatKindsForPattern = (pattern: WebtoonScrollChoreographyPattern): WebtoonScrollBeatKind[] => {
  const byPattern: Record<WebtoonScrollChoreographyPattern, WebtoonScrollBeatKind[]> = {
    dialogue_air: ["panel", "bubble_space", "reaction_micro"],
    emotional_pause_reveal: ["panel", "pause_space", "borderless_scene", "impact_panel"],
    action_runway: ["panel", "transition_air", "panel", "impact_panel"],
    vertical_panorama: ["borderless_scene", "panel", "transition_air"],
    micro_reaction_chain: ["panel", "reaction_micro", "reaction_micro", "bubble_space"],
    impact_drop: ["panel", "pause_space", "impact_panel"],
  };
  return byPattern[pattern];
};

const defaultFramingForBeat = (kind: WebtoonScrollBeatKind, index: number): WebtoonScrollFraming => {
  if (kind === "impact_panel") return "wide";
  if (kind === "borderless_scene" || kind === "transition_air") return "environment";
  if (kind === "reaction_micro") return "closeup";
  if (kind === "bubble_space" || kind === "pause_space") return "wide";
  return index % 2 === 0 ? "portrait" : "closeup";
};

const defaultWidthForBeat = (
  kind: WebtoonScrollBeatKind,
  pattern: WebtoonScrollChoreographyPattern,
  index: number
): WebtoonScrollWidthProfile => {
  if (kind === "impact_panel") return pattern === "vertical_panorama" || pattern === "impact_drop" ? "full" : "wide";
  if (kind === "pause_space" || kind === "borderless_scene") return pattern === "vertical_panorama" ? "full" : "wide";
  if (kind === "bubble_space") return "medium";
  if (kind === "reaction_micro") return "tiny";
  if (kind === "transition_air") return index % 2 === 0 ? "narrow" : "medium";
  if (pattern === "dialogue_air" || pattern === "micro_reaction_chain") return index % 2 === 0 ? "medium" : "narrow";
  if (pattern === "action_runway") return index % 2 === 0 ? "medium" : "narrow";
  return "medium";
};

const defaultXPositionForBeat = (
  kind: WebtoonScrollBeatKind,
  pattern: WebtoonScrollChoreographyPattern,
  index: number
): WebtoonScrollXPosition => {
  if (kind === "pause_space" || kind === "borderless_scene" || kind === "impact_panel") return "center";
  if (kind === "transition_air") return "drift";
  if (pattern === "action_runway") return index % 2 === 0 ? "left" : "right";
  if (pattern === "micro_reaction_chain") return index % 2 === 0 ? "left" : "right";
  if (kind === "reaction_micro") return index % 2 === 0 ? "right" : "left";
  if (kind === "bubble_space") return "center";
  return index % 3 === 0 ? "left" : index % 3 === 1 ? "center" : "right";
};

const defaultShapeForBeat = (
  kind: WebtoonScrollBeatKind,
  pattern: WebtoonScrollChoreographyPattern,
  index: number
): WebtoonScrollShapeStyle => {
  if (kind === "pause_space" || kind === "bubble_space" || kind === "borderless_scene" || kind === "transition_air") return "borderless";
  if (kind === "reaction_micro") return "inset";
  if (pattern === "action_runway" && (kind === "panel" || kind === "impact_panel")) return "diagonal";
  if (pattern === "micro_reaction_chain") return index % 2 === 0 ? "inset" : "soft_border";
  if (kind === "impact_panel") return "soft_border";
  return index % 3 === 0 ? "soft_border" : "rect";
};

const defaultVerticalRoleForBeat = (
  kind: WebtoonScrollBeatKind,
  pattern: WebtoonScrollChoreographyPattern
): WebtoonScrollVerticalRole => {
  if (kind === "pause_space") return "pause";
  if (kind === "impact_panel") return pattern === "action_runway" ? "rush" : "drop";
  if (kind === "borderless_scene" && pattern === "emotional_pause_reveal") return "reveal";
  if (kind === "transition_air") return pattern === "action_runway" ? "rush" : "pause";
  if (kind === "bubble_space" || kind === "reaction_micro") return "tap";
  if (pattern === "vertical_panorama") return "drop";
  return "tap";
};

const defaultDistanceForBeat = (
  kind: WebtoonScrollBeatKind,
  pattern: WebtoonScrollChoreographyPattern
): WebtoonScrollDistance => {
  if (kind === "pause_space") return pattern === "impact_drop" ? "very_long" : "long";
  if (kind === "borderless_scene") return pattern === "vertical_panorama" ? "very_long" : "long";
  if (kind === "impact_panel") return pattern === "action_runway" ? "long" : "medium";
  if (kind === "bubble_space" || kind === "reaction_micro") return "short";
  if (kind === "transition_air") return "medium";
  return "medium";
};

const isNonPanelScrollBeat = (kind: WebtoonScrollBeatKind): boolean =>
  kind !== "panel" && kind !== "impact_panel";

const getRequiredScrollBeatKinds = (pattern: WebtoonScrollChoreographyPattern): WebtoonScrollBeatKind[] => {
  const byPattern: Record<WebtoonScrollChoreographyPattern, WebtoonScrollBeatKind[]> = {
    dialogue_air: ["bubble_space", "reaction_micro"],
    emotional_pause_reveal: ["pause_space", "borderless_scene"],
    action_runway: ["transition_air", "reaction_micro"],
    vertical_panorama: ["borderless_scene", "transition_air"],
    micro_reaction_chain: ["reaction_micro", "bubble_space"],
    impact_drop: ["pause_space", "impact_panel"],
  };
  return byPattern[pattern];
};

const buildScrollBeatIntent = (kind: WebtoonScrollBeatKind, pattern: WebtoonScrollChoreographyPattern): string => {
  const intents: Record<WebtoonScrollBeatKind, string> = {
    panel: `framed story beat for ${pattern}`,
    pause_space: "large white pause space that creates silence before the next visual beat",
    bubble_space: "open whitespace carrying only a readable speech bubble or narration cue",
    borderless_scene: "borderless open scene that bleeds into surrounding white space",
    reaction_micro: "small reaction close-up or gesture beat that breaks the regular panel rhythm",
    impact_panel: "large impact beat that lands lower in the scroll",
    transition_air: "quiet transition space with environmental air or motion residue",
  };
  return intents[kind];
};

const makeScrollBeat = (
  kind: WebtoonScrollBeatKind,
  pattern: WebtoonScrollChoreographyPattern,
  index: number,
  weight?: number
): WebtoonScrollChoreography["beats"][number] => ({
  kind,
  height_weight: clampNumber(weight || (kind === "pause_space" ? 3 : kind === "impact_panel" ? 5 : 2), 1, 6),
  visual_intent: buildScrollBeatIntent(kind, pattern),
  framing: defaultFramingForBeat(kind, index),
  width_profile: defaultWidthForBeat(kind, pattern, index),
  x_position: defaultXPositionForBeat(kind, pattern, index),
  shape_style: defaultShapeForBeat(kind, pattern, index),
  vertical_role: defaultVerticalRoleForBeat(kind, pattern),
  scroll_distance: defaultDistanceForBeat(kind, pattern),
});

const enforceWebtoonScrollBeatVariety = (
  beats: WebtoonScrollChoreography["beats"],
  pattern: WebtoonScrollChoreographyPattern
): WebtoonScrollChoreography["beats"] => {
  const next = beats.map((beat) => ({ ...beat }));
  const requiredKinds = getRequiredScrollBeatKinds(pattern);

  for (const requiredKind of requiredKinds) {
    if (next.some((beat) => beat.kind === requiredKind)) continue;
    const replaceIndex = next.findIndex((beat) => beat.kind === "panel");
    if (replaceIndex >= 0) {
      next[replaceIndex] = makeScrollBeat(requiredKind, pattern, replaceIndex);
    } else if (next.length < 6) {
      next.push(makeScrollBeat(requiredKind, pattern, next.length));
    } else {
      next[next.length - 1] = makeScrollBeat(requiredKind, pattern, next.length - 1);
    }
  }

  let panelRun = 0;
  for (let index = 0; index < next.length; index++) {
    const beat = next[index];
    if (beat.kind === "panel") {
      panelRun += 1;
      if (panelRun >= 3) {
        const replacementKind: WebtoonScrollBeatKind = index % 2 === 0 ? "transition_air" : "reaction_micro";
        next[index] = makeScrollBeat(replacementKind, pattern, index, 2);
        panelRun = 0;
      }
    } else {
      panelRun = 0;
    }
  }

  const minNonPanelCount = next.length >= 4 ? 2 : 1;
  while (next.filter((beat) => isNonPanelScrollBeat(beat.kind)).length < minNonPanelCount) {
    const replaceIndex = next.findIndex((beat) => beat.kind === "panel");
    if (replaceIndex < 0) break;
    const replacementKind: WebtoonScrollBeatKind = replaceIndex % 2 === 0 ? "bubble_space" : "transition_air";
    next[replaceIndex] = makeScrollBeat(replacementKind, pattern, replaceIndex);
  }

  const totalWeight = next.reduce((sum, beat) => sum + beat.height_weight, 0);
  const nonPanelWeight = next
    .filter((beat) => isNonPanelScrollBeat(beat.kind))
    .reduce((sum, beat) => sum + beat.height_weight, 0);
  const minNonPanelWeight = Math.ceil(totalWeight * 0.35);
  if (nonPanelWeight < minNonPanelWeight) {
    const targetIndex = next.findIndex((beat) => isNonPanelScrollBeat(beat.kind));
    if (targetIndex >= 0) {
      next[targetIndex] = {
        ...next[targetIndex],
        height_weight: clampNumber(next[targetIndex].height_weight + (minNonPanelWeight - nonPanelWeight), 1, 6),
      };
    }
  }

  for (let index = 0; index < next.length; index++) {
    const beat = next[index];
    beat.framing = beat.framing || defaultFramingForBeat(beat.kind, index);
    beat.width_profile = beat.width_profile || defaultWidthForBeat(beat.kind, pattern, index);
    beat.x_position = beat.x_position || defaultXPositionForBeat(beat.kind, pattern, index);
    beat.shape_style = beat.shape_style || defaultShapeForBeat(beat.kind, pattern, index);
    beat.vertical_role = beat.vertical_role || defaultVerticalRoleForBeat(beat.kind, pattern);
    beat.scroll_distance = beat.scroll_distance || defaultDistanceForBeat(beat.kind, pattern);
  }

  const maxFullCount = Math.max(1, Math.floor(next.length * 0.4));
  let fullCount = next.filter((beat) => beat.width_profile === "full").length;
  for (let index = 0; index < next.length && fullCount > maxFullCount; index++) {
    const beat = next[index];
    if (beat.width_profile !== "full" || beat.kind === "impact_panel") continue;
    beat.width_profile = beat.kind === "borderless_scene" ? "wide" : "medium";
    fullCount -= 1;
  }

  const compactWidthCount = () =>
    next.filter((beat) => beat.width_profile === "medium" || beat.width_profile === "narrow" || beat.width_profile === "tiny").length;
  while (next.length >= 3 && compactWidthCount() < 2) {
    const targetIndex = next.findIndex((beat) => beat.width_profile === "wide" || beat.width_profile === "full");
    if (targetIndex < 0) break;
    next[targetIndex].width_profile = compactWidthCount() === 0 ? "narrow" : "tiny";
    next[targetIndex].x_position = targetIndex % 2 === 0 ? "left" : "right";
  }

  if (next.length >= 3 && next.every((beat) => beat.x_position === "center")) {
    next[0].x_position = "left";
    next[Math.min(2, next.length - 1)].x_position = "right";
  }
  if (next.length >= 4 && !next.some((beat) => beat.x_position === "drift")) {
    const targetIndex = next.findIndex((beat) => beat.kind === "transition_air" || beat.kind === "borderless_scene");
    if (targetIndex >= 0) next[targetIndex].x_position = "drift";
  }

  const hasDynamicShape = next.some((beat) =>
    beat.shape_style === "borderless" ||
    beat.shape_style === "diagonal" ||
    beat.shape_style === "inset" ||
    beat.shape_style === "overlap"
  );
  if (!hasDynamicShape) {
    const targetIndex = next.findIndex((beat) => isNonPanelScrollBeat(beat.kind));
    if (targetIndex >= 0) {
      next[targetIndex].shape_style = "borderless";
    } else if (next.length > 1) {
      next[1].shape_style = pattern === "action_runway" ? "diagonal" : "inset";
    }
  }

  if (!next.some((beat) => beat.vertical_role === "pause" || beat.vertical_role === "drop" || beat.vertical_role === "reveal")) {
    const targetIndex = next.findIndex((beat) => beat.kind === "pause_space" || beat.kind === "borderless_scene" || beat.kind === "impact_panel");
    if (targetIndex >= 0) {
      next[targetIndex].vertical_role = next[targetIndex].kind === "impact_panel" ? "drop" : "pause";
    }
  }

  if (!next.some((beat) => beat.scroll_distance === "long" || beat.scroll_distance === "very_long")) {
    const targetIndex = next.findIndex((beat) => beat.kind === "pause_space" || beat.kind === "borderless_scene" || beat.kind === "impact_panel");
    if (targetIndex >= 0) next[targetIndex].scroll_distance = "long";
  }

  if (pattern === "vertical_panorama") {
    const targetIndex = next.findIndex((beat) => beat.kind === "borderless_scene" || beat.vertical_role === "drop");
    if (targetIndex >= 0) {
      next[targetIndex].width_profile = "full";
      next[targetIndex].shape_style = "borderless";
      next[targetIndex].vertical_role = "drop";
      next[targetIndex].scroll_distance = "very_long";
      next[targetIndex].height_weight = clampNumber(Math.max(next[targetIndex].height_weight, 5), 1, 6);
    }
  }

  if (pattern === "impact_drop") {
    const pauseIndex = next.findIndex((beat) => beat.kind === "pause_space");
    if (pauseIndex >= 0) {
      next[pauseIndex].shape_style = "borderless";
      next[pauseIndex].vertical_role = "pause";
      next[pauseIndex].scroll_distance = "very_long";
      next[pauseIndex].height_weight = clampNumber(Math.max(next[pauseIndex].height_weight, 4), 1, 6);
    }
    const impactIndex = next.findIndex((beat) => beat.kind === "impact_panel");
    if (impactIndex >= 0) {
      next[impactIndex].width_profile = "full";
      next[impactIndex].vertical_role = "drop";
      next[impactIndex].scroll_distance = "long";
    }
  }

  return next;
};

const finalizeWebtoonScrollChoreography = (params: {
  rawChoreography: any;
  pageNumber: number;
  totalPages: number;
  dynamicLayout?: WebtoonDynamicLayout;
  narrativeFunction?: string;
}): WebtoonScrollChoreography => {
  const segmentRole = getWebtoonSegmentRole(params.pageNumber, params.totalPages);
  const fallbackPattern = inferScrollPatternFromLayout(params.dynamicLayout, segmentRole, params.narrativeFunction);
  const choreographyPattern = asScrollPattern(params.rawChoreography?.choreography_pattern, fallbackPattern);
  const rawBeats = Array.isArray(params.rawChoreography?.beats) ? params.rawChoreography.beats : [];
  const fallbackKinds = defaultScrollBeatKindsForPattern(choreographyPattern);
  const beatCount = clampNumber(Math.round(Number(rawBeats.length || fallbackKinds.length) || fallbackKinds.length), 2, 6);

  const rawNormalizedBeats = Array.from({ length: beatCount }, (_, index) => {
    const rawBeat = rawBeats[index] || {};
    const fallbackKind = fallbackKinds[index] || fallbackKinds[fallbackKinds.length - 1] || "panel";
    const kind = asScrollBeatKind(rawBeat.kind, fallbackKind);
    const heightWeight = clampNumber(Math.round(Number(rawBeat.height_weight) || (kind === "pause_space" ? 2 : kind === "impact_panel" ? 5 : 3)), 1, 6);
    const framing = asScrollFraming(rawBeat.framing) || defaultFramingForBeat(kind, index);
    const widthProfile = asScrollWidthProfile(rawBeat.width_profile) || defaultWidthForBeat(kind, choreographyPattern, index);
    const xPosition = asScrollXPosition(rawBeat.x_position) || defaultXPositionForBeat(kind, choreographyPattern, index);
    const shapeStyle = asScrollShapeStyle(rawBeat.shape_style) || defaultShapeForBeat(kind, choreographyPattern, index);
    const verticalRole = asScrollVerticalRole(rawBeat.vertical_role) || defaultVerticalRoleForBeat(kind, choreographyPattern);
    const scrollDistance = asScrollDistance(rawBeat.scroll_distance) || defaultDistanceForBeat(kind, choreographyPattern);
    const visualIntent = String(rawBeat.visual_intent || "").trim() || `${kind} beat for ${choreographyPattern}`;
    const textIntent = String(rawBeat.text_intent || "").trim();

    return {
      kind,
      height_weight: heightWeight,
      visual_intent: visualIntent,
      ...(textIntent ? { text_intent: textIntent } : {}),
      framing,
      width_profile: widthProfile,
      x_position: xPosition,
      shape_style: shapeStyle,
      vertical_role: verticalRole,
      scroll_distance: scrollDistance,
    };
  });
  const beats = enforceWebtoonScrollBeatVariety(rawNormalizedBeats, choreographyPattern);

  return {
    segment_index: params.pageNumber,
    canvas_size: "1024x3072",
    segment_role: segmentRole,
    choreography_pattern: choreographyPattern,
    beats,
  };
};

const inferContentDrivenFocusPanelIndex = (panels: WebtoonDynamicLayout["panels"]): number => {
  const impactIndex = panels.findIndex((panel) => panel.scene_type === "impact");
  if (impactIndex >= 0) return impactIndex + 1;

  let bestIndex = 0;
  let bestWeight = -1;
  panels.forEach((panel, index) => {
    if (panel.height_weight >= bestWeight) {
      bestWeight = panel.height_weight;
      bestIndex = index;
    }
  });
  return bestIndex + 1;
};

const wouldRepeatThreeTimes = (pattern: WebtoonCorePattern, previousPatterns: string[]) => {
  const recent = previousPatterns.slice(-2);
  return recent.length === 2 && recent[0] === pattern && recent[1] === pattern;
};

const getOutlineNarrativeFunction = (outline: PlanOutline | null | undefined, pageNumber: number) =>
  outline?.page_outlines?.[pageNumber - 1]?.narrative_function;

const finalizeWebtoonDynamicLayout = (params: {
  rawLayout: any;
  pageNumber: number;
  totalPages: number;
  previousPatterns: string[];
  narrativeFunction?: string;
}) => {
  const explicitCorePattern = WEBTOON_CORE_PATTERNS.includes(params.rawLayout?.core_pattern)
    ? (params.rawLayout.core_pattern as WebtoonCorePattern)
    : null;
  const parsedLayout = parseDynamicLayout(params.rawLayout);
  const explicitGapProfile = WEBTOON_GAP_PROFILES.includes(params.rawLayout?.gap_profile)
    ? params.rawLayout.gap_profile
    : null;
  const rawFocusPanelIndex = Math.round(Number(params.rawLayout?.focus_panel_index));
  const hasExplicitFocusPanelIndex = Number.isFinite(rawFocusPanelIndex)
    && rawFocusPanelIndex >= 1
    && rawFocusPanelIndex <= parsedLayout.panel_count;
  const scoringFocusPanelIndex = hasExplicitFocusPanelIndex
    ? parsedLayout.focus_panel_index
    : inferContentDrivenFocusPanelIndex(parsedLayout.panels);
  const scoringGapProfile = explicitGapProfile
    || (parsedLayout.modifiers.includes("long_pause_gap") ? "dramatic" : "balanced");
  const segmentRole = getWebtoonSegmentRole(params.pageNumber, params.totalPages);
  const scored = chooseBestPattern({
    availablePatterns: DEFAULT_WEBTOON_PATTERN_CANDIDATES,
    previousPatterns: params.previousPatterns,
    narrativeFunction: params.narrativeFunction,
    segmentRole,
    panelCount: parsedLayout.panel_count,
    focusPanelIndex: scoringFocusPanelIndex,
    sceneTypes: parsedLayout.panels.map((panel) => panel.scene_type),
    modifiers: parsedLayout.modifiers,
    gapProfile: scoringGapProfile,
    heightWeights: parsedLayout.panels.map((panel) => panel.height_weight),
  });

  const bestBreakdown = scored.breakdowns.find((entry) => entry.pattern === scored.chosen) || scored.breakdowns[0];
  const explicitBreakdown = explicitCorePattern
    ? scored.breakdowns.find((entry) => entry.pattern === explicitCorePattern)
    : undefined;
  const repeatEscapeCandidate = explicitCorePattern
    ? scored.breakdowns.find((entry) => entry.pattern !== explicitCorePattern)
    : undefined;

  let chosenPattern = scored.chosen;
  let overrideApplied = false;
  let overrideReason = explicitCorePattern ? "keep_model_choice" : "use_scored_choice";

  if (explicitCorePattern && explicitBreakdown) {
    chosenPattern = explicitCorePattern;
    if (
      bestBreakdown.pattern !== explicitCorePattern &&
      bestBreakdown.finalScore - explicitBreakdown.finalScore > WEBTOON_PATTERN_OVERRIDE_MARGIN
    ) {
      chosenPattern = bestBreakdown.pattern;
      overrideApplied = true;
      overrideReason = "explicit_pattern_scored_lower";
    } else if (
      wouldRepeatThreeTimes(explicitCorePattern, params.previousPatterns) &&
      repeatEscapeCandidate &&
      repeatEscapeCandidate.finalScore >= explicitBreakdown.finalScore - WEBTOON_PATTERN_REPEAT_ESCAPE_MARGIN
    ) {
      chosenPattern = repeatEscapeCandidate.pattern;
      overrideApplied = true;
      overrideReason = "avoid_third_repeat";
    }
  } else {
    overrideApplied = chosenPattern !== parsedLayout.core_pattern;
    overrideReason = overrideApplied ? "replace_inferred_pattern" : "keep_inferred_pattern";
  }

  const finalLayout: WebtoonDynamicLayout = {
    ...parsedLayout,
    core_pattern: chosenPattern,
    gap_profile: explicitGapProfile || inferGapProfileForPattern(chosenPattern, parsedLayout.modifiers),
    focus_panel_index: hasExplicitFocusPanelIndex
      ? parsedLayout.focus_panel_index
      : inferFocusPanelIndexForPattern(parsedLayout.panels, chosenPattern),
  };

  return {
    layout: finalLayout,
    debugEntry: {
      page_index: params.pageNumber,
      narrative_function: params.narrativeFunction || "",
      segment_role: segmentRole,
      model_pattern: explicitCorePattern || undefined,
      chosen_pattern: chosenPattern,
      override_applied: overrideApplied,
      override_reason: overrideReason,
      recent_history: params.previousPatterns.slice(-2),
      intents: scored.intents,
      candidate_scores: scored.breakdowns.map((entry) => ({
        pattern: entry.pattern,
        baseFit: entry.baseFit,
        historyAdjustment: entry.historyAdjustment,
        gateAdjustment: entry.gateAdjustment,
        finalScore: entry.finalScore,
        reasons: entry.reasons,
      })),
    },
  };
};

const looksLikeHowToTopic = (topic: string): boolean => {
  const t = String(topic || "").trim();
  if (!t) return false;
  return /(방법|하는\s*법|만드는\s*법|만들기|레시피|조리법|요리|튜토리얼|가이드|절차|순서|단계|설치|세팅|설정|사용법|how\s*to|tutorial|guide|recipe|setup|install)/i.test(t);
};

const looksLikeActionTopic = (topic: string): boolean => {
  const t = String(topic || "").trim();
  if (!t) return false;
  return /(격투|싸움|대결|전투|배틀|결투|무술|복싱|킥복싱|레슬링|ufc|mma|액션|추격|도주|추적|잠입|전쟁|combat|fight|fighting|battle|duel|martial|chase)/i.test(t);
};

const getGeminiMaxOutputTokens = (): number => {
  const raw =
    ((import.meta as any).env?.VITE_CODEX_MAX_OUTPUT_TOKENS as unknown) ||
    ((import.meta as any).env?.VITE_GEMINI_MAX_OUTPUT_TOKENS as unknown);
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 30000;
};

const DEFAULT_MAX_PAGES_PER_REQUEST = 10;

const getGeminiMaxPagesPerRequest = (): number => {
  const raw =
    ((import.meta as any).env?.VITE_CODEX_MAX_PAGES_PER_REQUEST as unknown) ||
    ((import.meta as any).env?.VITE_GEMINI_MAX_PAGES_PER_REQUEST as unknown);
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  }
  return DEFAULT_MAX_PAGES_PER_REQUEST;
};

export const GEMINI_PLANNER_MODEL = "gpt-5.5";

const getGeminiPlannerModel = (): string => {
  const codexPreferred = (import.meta as any).env?.VITE_CODEX_PLANNER_MODEL as unknown;
  if (typeof codexPreferred === "string" && codexPreferred.trim()) return codexPreferred.trim();
  const preferred = (import.meta as any).env?.VITE_GEMINI_PLANNER_MODEL as unknown;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  return GEMINI_PLANNER_MODEL;
};

const getGeminiPlannerMaxOutputTokens = (fallback: number): number => {
  const preferred =
    ((import.meta as any).env?.VITE_CODEX_PLANNER_MAX_OUTPUT_TOKENS as unknown) ||
    ((import.meta as any).env?.VITE_GEMINI_PLANNER_MAX_OUTPUT_TOKENS as unknown);
  if (typeof preferred === "string" && preferred.trim()) {
    const parsed = Number(preferred);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
};

const extractGeminiResponseText = (json: any): string => {
  if (typeof json?.text === "string" && json.text.trim()) return json.text;
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
};

const coerceGeminiSources = (value: unknown): GroundingSource[] => {
  if (!Array.isArray(value)) return [];
  const dedup = new Map<string, GroundingSource>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const anyItem = item as any;
    const uri = String(anyItem.uri ?? anyItem.url ?? anyItem.link ?? "").trim();
    if (!uri) continue;
    const title = String(anyItem.title ?? anyItem.name ?? "참고 자료").trim() || "참고 자료";
    if (!dedup.has(uri)) dedup.set(uri, { title, uri });
  }
  return Array.from(dedup.values());
};

const extractGeminiWebSearchSources = (json: any): GroundingSource[] => {
  const chunks = json?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  return coerceGeminiSources(chunks.map((chunk: any) => chunk?.web).filter(Boolean));
};

const normalizeSchemaType = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (["object", "array", "string", "number", "integer", "boolean", "null"].includes(normalized)) {
    return normalized;
  }
  return undefined;
};

const convertGeminiSchemaToJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== "object") return schema;

  const type = normalizeSchemaType(schema.type);
  const next: any = {};

  if (schema.description) next.description = schema.description;
  if (Array.isArray(schema.enum)) next.enum = [...schema.enum];

  if (type === "object") {
    next.type = "object";
    const normalizedProperties = Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, value]) => [key, convertGeminiSchemaToJsonSchema(value)])
    );
    next.properties = normalizedProperties;
    const propertyKeys = Object.keys(normalizedProperties);
    next.required = propertyKeys;
    next.additionalProperties = false;
  } else if (type === "array") {
    next.type = "array";
    next.items = convertGeminiSchemaToJsonSchema(schema.items || {});
  } else if (type) {
    next.type = type;
  }

  if (schema.nullable) {
    return {
      anyOf: [
        Object.keys(next).length > 0 ? next : {},
        { type: "null" }
      ]
    };
  }

  return next;
};

const requestGeminiStructured = async (params: {
  systemInstruction: string;
  contents: string;
  responseSchema: any;
  schemaName: string;
  reasoningEffort: GeminiReasoningEffort;
  enableSearch?: boolean;
  maxOutputTokens: number;
}): Promise<{ text: string; sources: GroundingSource[]; response_json: any }> => {
  const model = getGeminiPlannerModel();
  const schema = convertGeminiSchemaToJsonSchema(params.responseSchema);

  const baseConfig: any = {
    systemInstruction: params.systemInstruction,
    responseMimeType: "application/json",
    responseJsonSchema: schema,
    maxOutputTokens: params.maxOutputTokens,
    reasoningEffort: params.reasoningEffort
  };

  const withSearch = (config: any) =>
    params.enableSearch
      ? {
        ...config,
        tools: [{ googleSearch: {} }]
      }
      : config;

  const attempts = params.enableSearch
    ? [withSearch(baseConfig), baseConfig]
    : [baseConfig];

  let lastError: any = null;
  let json: any = null;
  for (const config of attempts) {
    try {
      json = await postJson<any>("/api/codex/generate-content", {
        request: {
          model,
          contents: { parts: [{ text: params.contents }] },
          config
        }
      });
      break;
    } catch (e: any) {
      lastError = e;
      const message = String(e?.message || "");
      if (/authentication|permission|quota|rate-?limit|oauth|login/i.test(message)) throw e;
    }
  }

  if (!json) throw lastError || new Error("Codex planner request failed.");

  return {
    text: extractGeminiResponseText(json).trim(),
    sources: extractGeminiWebSearchSources(json),
    response_json: json
  };
};

const safeParseJson = (text: string) => {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return JSON.parse(text);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("JSON extraction failed in Planner:", text);
    throw e;
  }
};

const buildPaperResearchPackNotes = (brief: PaperBrief): string => {
  const explicitUnits = Array.isArray(brief.paper_story_units)
    ? brief.paper_story_units.filter((unit) =>
      unit && (unit.step || unit.reader_question || unit.opening_scene || unit.page_reveal)
    )
    : [];
  const paperDomain = String(brief.domain_guess || "").trim() || "이 연구 분야";
  const firstPagePlainScene =
    paperDomain.includes("AI") || /인공지능|머신러닝|모델|language|vision|LLM/i.test(`${paperDomain} ${brief.paper_title}`)
      ? "공개된 웹 문서, 이미지, 코드, 대화 예시가 큰 자료 흐름처럼 모이고, 범용 AI 모델이 그 자료에서 일반적인 패턴을 배우는 장면"
      : `${paperDomain}에서 실제 사람들이 쓰는 공개 자료, 기록, 화면, 도구가 차분히 쌓여 있는 장면`;
  const firstPagePlainSpeech =
    paperDomain.includes("AI") || /인공지능|머신러닝|모델|language|vision|LLM/i.test(`${paperDomain} ${brief.paper_title}`)
      ? "인터넷에는 공개된 글과 이미지, 코드 같은 자료가 정말 많이 있어. 범용 AI 모델은 이런 자료를 많이 보면서, 사람들이 말하고 그리고 설명하는 패턴을 배워 왔어. 여기서는 일단 그 배경부터 보면 돼."
      : `${paperDomain}에는 사람들이 남긴 공개 자료와 기록이 있어. 연구는 보통 이런 자료가 어떻게 쌓이고 쓰이는지 살펴보는 데서 출발해. 여기서는 먼저 그 배경부터 천천히 보면 돼.`;
  const fallbackUnits = [
    {
      step: "원래 세상은 이렇다",
      reader_question: "이 분야에서는 원래 어떤 상황이 벌어지고 있었나?",
      opening_scene: firstPagePlainScene,
      page_reveal: "논문이 다루는 세계와 맥락이 먼저 보인다.",
      page_speech_flow: firstPagePlainSpeech,
      dont_explain_yet: "논문의 결론, 수치 결과, 핵심 기여를 아직 말하지 않는다.",
      allowed_content: [
        `${paperDomain}의 실제 배경 세계`,
        "논문에 직접 연결되는 공개 자료, 기록, 도구, 화면",
        "아직 문제가 터지기 전의 평범한 흐름",
        "범용 모델이나 일반 시스템이 많은 공개 자료에서 패턴을 배울 수 있다는 정도"
      ],
      forbidden_content: [
        "논문에 없는 임의의 고양이 이야기, 상자, 서랍, 창고, 버튼, 게임, 동화 같은 가짜 예시",
        "비유만 있고 실제 연구 배경이 무엇인지 알 수 없는 장면",
        "전문 영역의 구체적 데이터 부족 문제",
        "이 논문의 연구 질문, 방법, 결과, 기여, 한계",
        "왜 중요한지 직접 선언하는 문장"
      ],
      next_page_tease: "그런데 이 평범한 흐름 안에서 이상한 틈이 보이기 시작한다.",
      source_cue: brief.source_cues[0] || ""
    },
    {
      step: "그런데 이상한 틈이 보인다",
      reader_question: "겉으로는 괜찮아 보여도 어디서 불편함이나 빈틈이 생기나?",
      opening_scene: brief.core_problem || "반복되는 실패나 해결되지 않는 불편함이 드러나는 장면",
      page_reveal: "이 주제에는 그냥 넘어가기 어려운 틈이 있다.",
      page_speech_flow: "처음에는 자료도 있고 도구도 있어 보여. 그런데 가까이 들여다보면, 모든 상황이 그렇게 매끈하게 흘러가지는 않아. 여기서 작은 틈이 보이기 시작해.",
      dont_explain_yet: "새 방법과 결과를 아직 공개하지 않는다.",
      allowed_content: [
        "배경 세계에서 실제로 생기는 불편함이나 실패",
        "겉보기에는 자료/도구가 충분해 보여도 해결되지 않는 틈",
        "문제가 있다는 느낌"
      ],
      forbidden_content: [
        "이 문제가 왜 중요한지에 대한 본격 논증",
        "기존 연구 한계의 세부 목록",
        "새 방법, 실험, 결과"
      ],
      next_page_tease: "이 틈이 왜 연구 문제로 커지는지 따라간다.",
      source_cue: brief.source_cues[1] || ""
    },
    {
      step: "그래서 이 문제가 중요해진다",
      reader_question: "이 빈틈은 왜 사소한 문제가 아니라 연구 문제가 되나?",
      opening_scene: brief.motivation_context || brief.core_problem || "문제가 커지는 배경을 보여주는 장면",
      page_reveal: "문제의 중요성이 독자에게 납득된다.",
      page_speech_flow: "이 틈이 한두 번 불편한 정도라면 그냥 넘어갈 수도 있어. 그런데 같은 문제가 반복되면 이야기가 달라져. 연구가 필요한 이유가 여기서 생겨.",
      dont_explain_yet: "연구 질문과 방법을 너무 빨리 말하지 않는다.",
      allowed_content: [
        "앞 페이지의 틈이 커졌을 때 생기는 영향",
        "그냥 불편함이 아니라 연구로 다룰 만한 이유",
        "독자가 납득할 수 있는 필요성"
      ],
      forbidden_content: [
        "논문의 정확한 연구 질문",
        "방법 구조",
        "결과와 기여"
      ],
      next_page_tease: "이미 있던 방식들은 이 문제를 어디까지 다뤘을까?",
      source_cue: ""
    },
    {
      step: "기존 방식은 여기서 막힌다",
      reader_question: "이전 접근은 어디까지 해냈고, 어디서 부족했나?",
      opening_scene: brief.prior_limitations[0] || "기존 방법이 한계에 부딪히는 비교 장면",
      page_reveal: "기존 방식의 한계가 보인다.",
      page_speech_flow: "이미 해보던 방식들이 없었던 건 아니야. 다만 그 방식들이 잘 닿는 곳과, 끝내 닿지 못하는 곳이 갈려. 이 논문은 바로 그 경계에서 출발해.",
      dont_explain_yet: "논문의 핵심 기여와 결과를 아직 말하지 않는다.",
      allowed_content: [
        "기존 접근이 해낸 부분",
        "기존 접근이 막히는 지점",
        "왜 새 질문이 필요해지는지"
      ],
      forbidden_content: [
        "논문의 새 방법을 해결책처럼 공개하기",
        "실험 결과",
        "최종 기여와 한계"
      ],
      next_page_tease: "그래서 논문은 질문을 조금 다르게 잡는다.",
      source_cue: ""
    },
    {
      step: "이 논문은 질문을 이렇게 바꾼다",
      reader_question: "이 논문은 문제를 어떤 질문으로 다시 잡았나?",
      opening_scene: brief.research_question || "연구자가 질문을 다시 정리하는 장면",
      page_reveal: "논문의 연구 질문이 드러난다.",
      page_speech_flow: "그래서 논문은 질문을 조금 다르게 잡아. 그냥 더 많이 하자는 쪽이 아니라, 무엇을 어떻게 확인해야 이 틈을 좁힐 수 있는지 묻는 거야.",
      dont_explain_yet: "검증 결과와 한계를 아직 말하지 않는다.",
      allowed_content: [
        "논문이 잡은 핵심 질문",
        "앞선 한계와 질문이 연결되는 방식",
        "무엇을 확인하려는지"
      ],
      forbidden_content: [
        "방법의 세부 절차",
        "결과 수치",
        "논문 전체 결론"
      ],
      next_page_tease: "이 질문에 답하기 위해 어떤 아이디어를 꺼내는지 본다.",
      source_cue: ""
    },
    {
      step: "핵심 아이디어/방법이 나온다",
      reader_question: "이 논문은 어떤 아이디어나 방법으로 접근했나?",
      opening_scene: brief.method_summary || brief.main_contributions[0] || "핵심 방법을 간단한 구조로 보여주는 장면",
      page_reveal: "새 접근의 형태가 보인다.",
      page_speech_flow: "여기서 논문의 핵심 아이디어가 나와. 복잡한 세부를 한꺼번에 외우기보다, 이 방법이 앞의 질문에 어떻게 답하려는지 먼저 보면 돼.",
      dont_explain_yet: "결과가 좋았는지 나빴는지 먼저 단정하지 않는다.",
      allowed_content: [
        "핵심 아이디어나 방법의 큰 구조",
        "방법이 앞선 질문에 어떻게 연결되는지",
        "독자가 따라갈 수 있는 비유/도식"
      ],
      forbidden_content: [
        "검증 결과의 성공/실패 판단",
        "결과의 의미 해석",
        "한계와 최종 요약"
      ],
      next_page_tease: "이 아이디어가 실제로 통하는지는 검증 장면에서 확인한다.",
      source_cue: ""
    },
    {
      step: "검증 장면으로 들어간다",
      reader_question: "이 아이디어를 어떻게 확인했나?",
      opening_scene: "데이터, 실험, 비교표, 평가 장면을 만화적으로 단순화한 장면",
      page_reveal: "논문이 주장을 어떻게 확인하려 했는지 보인다.",
      page_speech_flow: "아이디어만으로는 충분하지 않아. 논문은 이걸 실제 자료나 실험으로 확인하려고 해. 이제 무엇과 무엇을 비교했는지 보는 차례야.",
      dont_explain_yet: "최종 의미와 한계를 아직 정리하지 않는다.",
      allowed_content: [
        "검증에 사용한 데이터/실험/비교의 큰 그림",
        "무엇과 무엇을 비교했는지",
        "결과를 읽기 전의 확인 방식"
      ],
      forbidden_content: [
        "결과가 의미하는 바를 먼저 해석하기",
        "최종 결론",
        "한계 정리"
      ],
      next_page_tease: "이제 결과가 무엇을 가리키는지 읽는다.",
      source_cue: brief.source_cues[2] || ""
    },
    {
      step: "결과가 의미하는 바를 읽는다",
      reader_question: "결과는 숫자 너머로 무엇을 보여주나?",
      opening_scene: brief.result_summary || "결과 그래프나 비교 장면을 독자가 읽는 장면",
      page_reveal: "결과가 말하는 핵심 의미가 보인다.",
      page_speech_flow: "결과는 숫자만 보는 게 아니야. 앞에서 물었던 질문에 어떤 쪽으로 답이 기우는지 읽어야 해. 여기서는 그 방향만 차분히 잡으면 돼.",
      dont_explain_yet: "논문의 전체 의미를 과장해서 결론내리지 않는다.",
      allowed_content: [
        "결과의 핵심 패턴",
        "그 패턴이 연구 질문에 주는 답",
        "결과를 과장하지 않은 의미"
      ],
      forbidden_content: [
        "모든 상황에 일반화된 결론",
        "한계를 지운 단정",
        "마지막 요약 카드"
      ],
      next_page_tease: "하지만 결과를 읽을 때 조심해야 할 경계도 남아 있다.",
      source_cue: ""
    },
    {
      step: "한계와 남은 질문을 인정한다",
      reader_question: "이 결과를 어디까지 믿고, 어디서는 조심해야 하나?",
      opening_scene: brief.limitations[0] || "한계와 남은 질문을 차분히 짚는 장면",
      page_reveal: "논문을 조심해서 읽어야 할 경계가 생긴다.",
      page_speech_flow: "그래도 여기서 끝난 이야기는 아니야. 결과가 말해주는 범위가 있고, 아직 조심해야 할 부분도 남아 있어. 좋은 논문일수록 그 경계를 같이 보여줘.",
      dont_explain_yet: "마지막 의미 정리는 다음 페이지로 남긴다.",
      allowed_content: [
        "논문이 인정한 한계",
        "결과 해석에서 조심할 점",
        "남은 질문"
      ],
      forbidden_content: [
        "논문 전체를 마지막 한 문장으로 정리하기",
        "한계를 무시한 홍보성 결론"
      ],
      next_page_tease: "그럼에도 이 논문이 남긴 의미를 마지막에 붙잡는다.",
      source_cue: ""
    },
    {
      step: "마지막으로 의미를 붙잡는다",
      reader_question: "그래서 이 논문이 우리에게 남긴 한 문장은 무엇인가?",
      opening_scene: "앞에서 본 배경, 문제, 방법, 결과가 한 장면으로 다시 모이는 마무리",
      page_reveal: brief.one_line_takeaway || "이 논문이 남긴 의미를 과장 없이 붙잡는다.",
      page_speech_flow: "처음에 봤던 배경으로 다시 돌아와 보자. 이 논문은 그 안에 있던 틈을 이런 방식으로 바라봤고, 여기까지는 꽤 의미 있는 단서를 남겼어.",
      dont_explain_yet: "",
      allowed_content: [
        "배경에서 시작해 문제, 질문, 방법, 결과, 한계로 이어진 흐름",
        "논문이 남긴 의미",
        "조심해서 읽어야 할 한계"
      ],
      forbidden_content: [
        "새로운 사실을 마지막에 처음 공개하기",
        "근거 없는 과장 결론"
      ],
      next_page_tease: "",
      source_cue: ""
    }
  ];
  const mergeUnique = (...groups: Array<string[] | undefined>): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const group of groups) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        const value = String(item || "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
      }
    }
    return out;
  };
  const firstPageNeverSay = [
    "논문에 없는 임의의 고양이 이야기, 상자, 서랍, 창고, 버튼, 게임, 동화 같은 가짜 예시",
    "비유만 있고 실제 연구 배경이 무엇인지 알 수 없는 장면",
    "전문 영역 자료가 부족하다는 문제",
    "전문 데이터 접근 비용, 보안, 개인정보, 법률 문제",
    "이 논문의 핵심 문제, 연구 질문, 방법, 결과, 기여, 한계",
    "왜 이 문제가 중요한지 직접 선언하는 문장",
    "문제의 답이나 해결 방향"
  ];
  const soundsTooLateForFirstPage = (text: string) =>
    /전문|개인정보|비용|보안|법률|의료|현장|부족|접근|연구\s*질문|방법|결과|기여|한계|해결|문제/.test(text);
  const soundsLikeInventedOpeningMetaphor = (text: string) =>
    /고양이|상자|서랍|창고|버튼|게임|동화|전설|외계|마법|왕국|퀘스트|카드|몬스터|로봇이야기|이야기\s*\d+/.test(text);
  const unsafeFirstPageText = (text: string) =>
    soundsTooLateForFirstPage(text) || soundsLikeInventedOpeningMetaphor(text);
  const firstPageAllowed = (items: string[] | undefined) =>
    Array.isArray(items)
      ? items.filter((item) => !unsafeFirstPageText(String(item || "")))
      : [];
  const storyUnits = (explicitUnits.length > 0 ? explicitUnits : fallbackUnits).map((unit, index) => {
    const fallback = fallbackUnits[Math.min(index, fallbackUnits.length - 1)];
    const openingScene = index === 0 && unsafeFirstPageText(unit.opening_scene || "")
      ? fallback.opening_scene
      : unit.opening_scene || fallback.opening_scene;
    const pageReveal = index === 0 && unsafeFirstPageText(unit.page_reveal || "")
      ? fallback.page_reveal
      : unit.page_reveal || fallback.page_reveal;
    return {
      ...fallback,
      ...unit,
      opening_scene: openingScene,
      page_reveal: pageReveal,
      page_speech_flow: index === 0 && unsafeFirstPageText(unit.page_speech_flow || "")
        ? fallback.page_speech_flow
        : unit.page_speech_flow || fallback.page_speech_flow,
      allowed_content: index === 0
        ? mergeUnique(firstPageAllowed(unit.allowed_content), fallback.allowed_content)
        : mergeUnique(unit.allowed_content, fallback.allowed_content),
      forbidden_content: index === 0
        ? mergeUnique(firstPageNeverSay, unit.forbidden_content, fallback.forbidden_content)
        : mergeUnique(unit.forbidden_content, fallback.forbidden_content),
      next_page_tease: unit.next_page_tease || fallback.next_page_tease,
      dont_explain_yet: unit.dont_explain_yet || fallback.dont_explain_yet,
      source_cue: unit.source_cue || fallback.source_cue || ""
    };
  });
  const formatUnitList = (items: string[] | undefined, fallback: string) =>
    (Array.isArray(items) && items.length > 0 ? items : [fallback])
      .map((item) => `     - ${item}`)
      .join("\n");

  const lines: string[] = [
    "[PAPER MODE]",
    `- title: ${brief.paper_title}`,
    `- domain: ${brief.domain_guess}`,
    `- track: ${brief.paper_mode_track === "methodology_focus" ? "방법론 중심" : "대중형 요약"}`,
    "",
    "[PAPER LEARNING STORY]",
    "- 처음부터 논문이 뭘 해결했는지 말하지 않습니다. 독자가 먼저 그 세계를 보고, 그 다음에 틈을 느끼고, 그 뒤에야 연구 질문으로 넘어갑니다.",
    "- 기본 흐름: 원래 세계 → 기대하던 흐름 → 작은 틈 → 중요해지는 이유 → 기존 한계 → 연구 질문 → 방법 → 검증 → 결과의 의미 → 한계와 남은 질문",
    "- 한 페이지는 하나의 걸음입니다. 인접 단계를 합칠 수는 있지만, 한 페이지에 세 걸음 이상 몰아넣지 않습니다.",
    "- 첫 페이지에서는 임의의 비유를 발명하지 않습니다. 논문이 실제로 다루는 분야의 자료, 사람, 도구, 화면, 현장을 보여주세요.",
    "",
    "[OPENING SCENE SEEDS]",
    "- 아래 항목은 첫 말풍선 후보가 아니라 장면의 씨앗입니다. 설명문으로 그대로 쓰지 말고, 눈앞에서 보이는 장면으로 바꾸세요.",
    ...(
      (Array.isArray(brief.opening_candidates) && brief.opening_candidates.length > 0
        ? brief.opening_candidates
        : [brief.reader_hook_example, brief.motivation_context].filter(Boolean)
      ).map((item) => `- ${item}`)
    ),
    "",
    "[PAPER STORY UNITS]",
    ...storyUnits.map((unit, index) => [
      `${index + 1}. ${unit.step}`,
      `   reader_question: ${unit.reader_question}`,
      `   opening_scene: ${unit.opening_scene}`,
      `   page_reveal: ${unit.page_reveal}`,
      `   page_speech_flow: ${unit.page_speech_flow || ""}`,
      `   dont_explain_yet: ${unit.dont_explain_yet || "없음"}`,
      `   allowed_content:\n${formatUnitList(unit.allowed_content, unit.page_reveal || unit.opening_scene || "이 페이지의 작은 한 걸음만 다룬다.")}`,
      `   forbidden_content:\n${formatUnitList(unit.forbidden_content, unit.dont_explain_yet || "다음 페이지 이후의 정보는 앞당기지 않는다.")}`,
      `   next_page_tease: ${unit.next_page_tease || "없음"}`,
      unit.source_cue ? `   source_cue: ${unit.source_cue}` : ""
    ].filter(Boolean).join("\n")),
    "",
    "[PAGE BUDGET]",
    brief.page_budget_note || `normal은 ${Math.max(brief.page_suggestions?.normal || 0, Math.min(storyUnits.length, 10))}페이지 안팎을 권장합니다. 줄일 때는 인접한 배경/중요성, 한계/마무리만 합치고 방법/검증/결과를 한 페이지에 몰아넣지 마세요.`,
    "",
    "[ONE LINE TAKEAWAY]",
    brief.one_line_takeaway || "핵심 한 줄 요약 없음",
    "",
    "[MOTIVATION CONTEXT]",
    brief.motivation_context || "연구 배경 요약 없음",
    ""
  ];

  if (brief.reader_hook_example) {
    lines.push("[READER HOOK EXAMPLE]");
    lines.push(brief.reader_hook_example);
    lines.push("");
  }

  lines.push(
    "[CORE PROBLEM]",
    brief.core_problem || "핵심 문제 요약 없음",
    ""
  );

  if (brief.research_question) {
    lines.push("[RESEARCH QUESTION]");
    lines.push(brief.research_question);
    lines.push("");
  }

  if (brief.prior_limitations.length > 0) {
    lines.push("[PRIOR LIMITATIONS]");
    for (const item of brief.prior_limitations) lines.push(`- ${item}`);
    lines.push("");
  }

  if (brief.main_contributions.length > 0) {
    lines.push("[MAIN CONTRIBUTIONS]");
    for (const item of brief.main_contributions) lines.push(`- ${item}`);
    lines.push("");
  }

  lines.push("[METHOD SUMMARY]");
  lines.push(brief.method_summary || "방법 요약 없음");
  lines.push("");
  lines.push("[RESULT SUMMARY]");
  lines.push(brief.result_summary || "결과 요약 없음");
  lines.push("");

  if (brief.limitations.length > 0) {
    lines.push("[LIMITATIONS]");
    for (const item of brief.limitations) lines.push(`- ${item}`);
    lines.push("");
  }

  if (brief.source_cues.length > 0) {
    lines.push("[SOURCE CUES]");
    for (const item of brief.source_cues) lines.push(`- ${item}`);
    lines.push("");
  }

  if (brief.warnings.length > 0) {
    lines.push("[WARNINGS]");
    for (const item of brief.warnings) lines.push(`- ${item}`);
    lines.push("");
  }

  lines.push("[PAPER COMIC INSTRUCTIONS]");
  lines.push(
    brief.paper_mode_track === "methodology_focus"
      ? "- 방법 설명이 중심이어도, 첫 페이지는 반드시 원래 세상/배경 장면을 먼저 보여주고, 기존 접근의 한계를 거쳐 방법 구조로 넘어가세요."
      : "- 기술 세부보다 독자가 배경을 보고 문제의 틈을 발견한 뒤, 무엇이 새롭고 어떤 의미가 있는지 이해하게 하세요."
  );
  lines.push("- 첫 페이지는 '왜 중요한가'를 바로 말하지 말고, 그 중요성이 생기는 배경 세계나 독자가 공감할 예시를 먼저 보여주세요.");
  lines.push("- 첫 페이지에서는 배경의 공기만 보여줘도 충분합니다. 전문 데이터 부족, 비용, 보안, 개인정보, 연구 질문, 방법, 결과는 다음 페이지 이후의 말입니다.");
  lines.push("- 초반 흐름은 '원래 세상 -> 이상한 틈 -> 중요성 -> 기존 한계 -> 연구 질문' 순서로 자연스럽게 늦춰 전개하세요.");
  lines.push("- [PAPER STORY UNITS]가 있으면 각 페이지는 해당 unit의 allowed_content 안에서만 설명하고, forbidden_content에 있는 정보는 대사/나레이션/화면 텍스트/장면 설명에 앞당겨 넣지 마세요.");
  lines.push("- next_page_tease는 페이지 끝의 작은 힌트로만 쓰세요. 힌트를 던진 뒤 같은 페이지에서 답까지 설명하면 실패입니다.");
  lines.push("- 방법/결과/기여/한계를 한 페이지에 몰아넣지 마세요. 독자의 생각이 한 번에 한 걸음만 움직이게 배분하세요.");
  lines.push("- reader_hook_example이 있으면 도입 컷에서 우선 활용하고, 없으면 motivation_context를 장면형 설명으로 풀어주세요.");
  lines.push("- public_summary는 배경/틈/의미를 넉넉히, methodology_focus는 배경/기존 한계 후 방법/검증을 넉넉히 다루세요.");
  lines.push("- 마지막 페이지는 정보 목록이 아니라, 앞에서 따라온 흐름을 한 번 붙잡으며 논문이 남긴 의미와 조심할 점을 정리하세요.");
  lines.push("- 본문 컷에 claim/evidence/caveat 태그를 노출하지 말고, 근거와 한계는 자연스러운 말이나 마지막 의미 정리로만 드러내세요.");

  return lines.join("\n").trim();
};

const overwriteLastPageWithPaperSummary = (plan: SeriesPlan, brief: PaperBrief): SeriesPlan => {
  if (!Array.isArray(plan.pages) || plan.pages.length === 0) return plan;

  const next = {
    ...plan,
    pages: plan.pages.map((page) => ({
      ...page,
      page: { ...page.page },
      layout: { ...page.layout },
      panels: page.panels.map((panel) => ({
        ...panel,
        render: { ...panel.render },
        dialogues: [...panel.dialogues]
      }))
    }))
  };

  const lastPage = next.pages[next.pages.length - 1];
  const panelCount = Math.max(1, lastPage.panels.length);
  const sourceLine = brief.source_cues.length > 0
    ? `근거 단서: ${brief.source_cues.slice(0, 2).join(" / ")}`
    : "근거 단서는 논문 본문과 캡션 기준으로 정리됨";
  const limitationLine = brief.limitations[0] || "한계는 후속 검증이 필요할 수 있음";
  const contributionsJoined = brief.main_contributions.slice(0, 2).join(" / ") || "주요 기여 요약";
  const openingMemory =
    brief.paper_story_units?.[0]?.page_reveal ||
    brief.motivation_context ||
    "처음에는 이 연구가 놓인 배경부터 살펴봤어요.";
  const problemMemory =
    brief.core_problem ||
    brief.paper_story_units?.[1]?.page_reveal ||
    "그 안에서 그냥 넘기기 어려운 틈이 보였죠.";
  const finalMeaning =
    brief.paper_story_units?.[brief.paper_story_units.length - 1]?.page_reveal ||
    brief.one_line_takeaway ||
    "이 논문은 그 틈을 이해하는 새 단서를 남겼어요.";

  const summaryBlocks = (() => {
    if (panelCount <= 1) {
      return [{
        title: "남긴 의미",
        scene: "A reflective closing page that gathers the background, problem, research idea, result meaning, and remaining caution into one calm visual flow.",
        dialogue: `[narration]처음엔 이 배경에서 출발했어요.\n[narration]${problemMemory}\n[narration]${finalMeaning}\n[narration]다만 ${limitationLine}`
      }];
    }
    if (panelCount === 2) {
      return [
        {
          title: "출발점",
          scene: "A closing recap panel that revisits the original world and the gap that made the paper necessary.",
          dialogue: `[narration]처음엔 이런 배경이 있었어요.\n[narration]${openingMemory}\n[narration]그러다 ${problemMemory}`
        },
        {
          title: "남긴 의미",
          scene: "A reflective closing panel that shows what the paper adds while keeping limitations visible.",
          dialogue: `[narration]그래서 논문은 이런 단서를 남겨요.\n[narration]${finalMeaning}\n[narration]다만 ${limitationLine}`
        }
      ];
    }
    if (panelCount === 3) {
      return [
        {
          title: "처음의 세계",
          scene: "A recap panel that revisits the field background before the research problem appeared.",
          dialogue: `[narration]처음엔 이 배경에서 시작했죠.\n[narration]${openingMemory}`
        },
        {
          title: "논문의 시도",
          scene: "A recap panel showing the question shift and the paper's approach as a simple visual path.",
          dialogue: `[narration]논문은 이 틈을 그냥 넘기지 않았어요.\n[narration]질문: ${brief.research_question || problemMemory}\n[narration]단서: ${contributionsJoined}`
        },
        {
          title: "남긴 의미",
          scene: "A closing recap panel that balances result meaning, limitations, and paper source cues without turning into a checklist.",
          dialogue: `[narration]결과가 가리킨 건 이거예요.\n[narration]${finalMeaning}\n[narration]다만 ${limitationLine}`
        }
      ];
    }

    const blocks = [
      {
        title: "원래 세상",
        scene: "A compact recap panel revisiting the original field context.",
        dialogue: `[narration]처음엔 이 배경을 봤어요.\n[narration]${openingMemory}`
      },
      {
        title: "보였던 틈",
        scene: "A recap panel showing the gap or discomfort that made the research question necessary.",
        dialogue: `[narration]그 안에서 이런 틈이 보였죠.\n[narration]${problemMemory}`
      },
      {
        title: "바뀐 질문",
        scene: "A recap panel showing how the paper reframed the problem as a research question.",
        dialogue: `[narration]그래서 질문이 이렇게 바뀌어요.\n[narration]${brief.research_question || "이 문제를 다른 각도에서 볼 수 있을까?"}`
      },
      {
        title: "시도한 방법",
        scene: "A recap panel that shows the method as a simple path rather than a dense technical list.",
        dialogue: `[narration]논문은 이런 방식으로 확인했어요.\n[narration]${brief.method_summary || contributionsJoined}`
      },
      {
        title: "결과의 의미",
        scene: "A recap panel that interprets what the result means for the original problem.",
        dialogue: `[narration]결과는 이 방향을 가리켜요.\n[narration]${brief.result_summary || finalMeaning}`
      },
      {
        title: "남은 질문",
        scene: "A closing note panel that acknowledges caution and evidence without becoming a rigid checklist.",
        dialogue: `[narration]그래도 여기까지만 조심해서 읽어야 해요.\n[narration]${limitationLine}\n[narration]${sourceLine}`
      }
    ];
    return blocks.slice(0, panelCount);
  })();

  lastPage.page.chapter_title = "논문 요약";
  lastPage.panels = lastPage.panels.map((panel, index) => {
    const block = summaryBlocks[index] || summaryBlocks[summaryBlocks.length - 1];
    const dialogueLines = String(block.dialogue || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return {
      ...panel,
      scene: block.scene,
      acting: "The guide character calmly points at recap visuals, notes, and simplified figure motifs.",
      dialogues: dialogueLines,
      camera: index === 0 ? "medium shot" : "close-up infographic composition",
      mood: index === summaryBlocks.length - 1 ? "clear and reflective" : "focused and informative"
    };
  });

  next.series_spec = {
    ...next.series_spec,
    constraints: {
      ...next.series_spec.constraints,
      creation_type: "paper",
      paper_mode_track: brief.paper_mode_track
    }
  };
  next.plan_meta = {
    ...(next.plan_meta || {}),
    rationale_short: `[논문 만화] ${brief.one_line_takeaway || brief.paper_title}`,
    paper_brief: {
      paper_title: brief.paper_title,
      paper_mode_track: brief.paper_mode_track,
      source_cues: brief.source_cues
    }
  };

  return next;
};

export const generatePlan = async (params: {
  topic: string;
  question_type: QuestionType;
  comic_mode: ComicMode;
  output_mode: OutputMode;
  publication_format?: PublicationFormat;
  manga_color_mode?: MangaColorMode;
  i2v_aspect_ratio?: I2VAspectRatio;
  tone_mode?: ToneMode;
  tone_level?: ToneLevel;
  intro_style?: IntroStyle;
  detail_level: ScriptDetail;
  language: Language;
  audience_level: AudienceLevel;
  delivery_style?: DeliveryStyleSpec;
  layout_variety: LayoutVariety;
  image_size: ImageSize;
  page_count: number;
  character_consistency_mode?: CharacterConsistencyMode;
  character_description: string;
  character_role: NarrativeRole;
  character_refs: { main: string; pack: string[] };
  product?: { label: string; reference_images: string[] };
  supporting_cast?: string;
  cast?: CharacterSpec[];
  style: SeriesSpec['anchors']['style'];
  templates: LayoutTemplate[];
  research?: { mode: ResearchMode; pack?: ResearchPack };
  gemini_reasoning_effort?: GeminiReasoningEffort;
}): Promise<SeriesPlan> => {
  const startedAt = Date.now();
  if (!Array.isArray(params.templates) || params.templates.length === 0) {
    throw new Error("Planner requires at least one layout template.");
  }
  const templateSummaries = params.templates.map(t => ({
    id: t.id,
    label: t.label,
    tier: t.variety_tier,
    panels: t.panels.length,
    ratios: t.panels.map(p => p.target_aspect_ratio)
  }));
  const webtoonAnchorTemplateSummaries = getWebtoonAnchorTemplateSummaries(params.templates);

  const isEduCinematic = params.comic_mode === "cinematic";
  const isPureCinematic = params.comic_mode === "pure_cinematic";
  const isAnyCinematic = isEduCinematic || isPureCinematic;
  const isHowTo = looksLikeHowToTopic(params.topic);
  const isActionTopic = looksLikeActionTopic(params.topic);
  const introStyle: IntroStyle = params.intro_style || "standard";
  const toneMode: ToneMode = params.tone_mode || "normal";
  const toneLevel: ToneLevel = params.tone_level || "medium";
  const outputMode: OutputMode = params.output_mode || "comic";
  const publicationFormat: PublicationFormat = params.publication_format || (outputMode === "kling_i2v" ? "kling_i2v" : "learning_comic");
  const mangaColorMode: MangaColorMode = params.manga_color_mode || "bw";
  const isKlingI2V = publicationFormat === "kling_i2v";
  const isWebtoon = publicationFormat === "webtoon";
  const isManga = publicationFormat === "manga";
  const isLearningComic = publicationFormat === "learning_comic";
  const isLearningComicPro = isLearningComic && params.layout_variety === "high";
  const isDynamicLayout = isWebtoon;
  const panelsPerPage = isKlingI2V ? 1 : isManga ? 6 : isWebtoon ? 3 : 4;
  const minPanels = isLearningComicPro ? 3 : isWebtoon ? 1 : isDynamicLayout ? 2 : panelsPerPage;
  const maxPanels = isLearningComicPro ? 7 : isDynamicLayout ? 5 : panelsPerPage;
  const i2vAspectRatio: I2VAspectRatio = params.i2v_aspect_ratio || "16:9";
  const characterConsistencyMode: CharacterConsistencyMode = params.character_consistency_mode || "loose";
  const geminiReasoningEffort: GeminiReasoningEffort = params.gemini_reasoning_effort || "medium";
  const webtoonAnchorGuidance = isWebtoon
    ? getWebtoonAnchorGuidance(webtoonAnchorTemplateSummaries, params.page_count)
    : "";

  const toneModeInstructionLearningOrEdu =
    toneMode === "gag"
      ? `
- 목표: 교육적 정확성을 유지하면서, '상황/리액션/비유'로 자연스럽게 웃기세요.
- 개그 방식: 가벼운 말장난/과장된 리액션/의인화/짧은 콜백 위주.
- 개그 강도(tone_level)를 존중하세요:
  - low: 위트/리액션은 0~1회 수준(거의 일반 톤).
  - medium: 컷 전체에 1~2회 정도(권장).
  - high: 컷마다 가벼운 코미디 리듬을 유지하되, 설명은 명료하게.
- 금지: 욕설/혐오/조롱/비하/노골적 성적 표현/특정 집단을 웃음 소재로 삼기.
- 정보 왜곡 금지: 웃기려고 정의/사실/인과를 바꾸지 마세요. 불확실하면 UNKNOWN 또는 "추가 리서치 필요".`
      : `
- 목표: 정확하고 명확하게 설명하세요. (가벼운 위트는 0~1회 정도만 허용)
- 우선순위: 정확성/명확성 > 재미.
- 과장/밈 남발 금지.`;

  const toneModeInstructionPureCinematic =
    toneMode === "gag"
      ? `
- 목표: 서사의 긴장감을 해치지 않는 선에서 리드미컬한 유머를 넣으세요.
- 개그 방식: 상황 아이러니/리액션/타이밍 중심. 설명형 개그는 금지입니다.
- 개그 강도(tone_level)를 존중하세요:
  - low: 분위기를 깨지 않는 짧은 위트 0~1회.
  - medium: 장면 전환마다 한 번씩 가벼운 코미디 비트.
  - high: 컷마다 코미디 리듬은 유지하되 플롯 긴장은 보존.
- 금지: 욕설/혐오/조롱/비하/노골적 성적 표현/특정 집단 희화화.`
      : `
- 목표: 영화/애니메이션/만화 대본처럼 몰입감 있는 감정선과 리듬을 우선하세요.
- 우선순위: 캐릭터 욕망/갈등/전환/클라이맥스 > 정보 설명.
- 과잉 해설/교훈 문장 금지.`;

  const toneModeInstruction = isPureCinematic ? toneModeInstructionPureCinematic : toneModeInstructionLearningOrEdu;

  const questionTypeInstruction = (() => {
    if (params.question_type === "compare") {
      return `

[질문 형태: 비교(Compare) - 매우 중요]
- "A가 더 낫다/승자" 같은 단정적 결론을 내리지 마세요.
- 비교는 반드시 3~5개의 '비교축(정의/책임, 검증가능성, 규제, 기술 접근 등)'에 기반해 구조화하세요.
- 가능하면 "조건부 결론"으로 마무리하세요. (예: "X가 중요한 상황에서는 A, Y가 중요한 상황에서는 B")
- 비교축이 불충분하거나 근거가 없으면 "직접 비교 불가/추가 리서치 필요"로 처리하세요.`
    }

    if (params.question_type === "review") {
      return `

[질문 형태: 리뷰(Review) - 매우 중요]
- 광고/선동/과장 문구를 쓰지 마세요. 근거가 부족하면 "UNKNOWN" 또는 "추가 확인 필요"로 처리하세요.
- 먼저 평가 기준(3~7개)을 선언하고, 각 기준별로 장점/단점을 균형 있게 제시하세요.
- "무조건 추천/최고/최악" 같은 단정은 금지. 마지막 컷은 "누구에게/어떤 조건에서 추천·비추천" 조건부 결론으로 마무리하세요.
- 가격/스펙/수치/연도/고유명사는 확인 가능한 범위에서만 사용하고, 불명확하면 넣지 마세요.`
    }

    if (introStyle === "myth_busting") {
      return `

[질문 형태: 설명(Explain) - 매우 중요 / 오프닝: 오해 깨기]
- 1컷은 독자가 흔히 하는 착각/선입견(짧은 한 문장)으로 시작하고, 바로 다음 컷에서 '정정'으로 이어지게 구성하세요.
- 오해를 비웃거나 조롱하지 말고, "헷갈릴 수 있어요" 톤으로 부드럽게 교정하세요.
- 구조: (헷갈리는 장면) → (왜 헷갈리는지 관찰) → (이름/원리 연결) → (예시/비교) → (짧은 정리).`
    }

    if (isHowTo) {
      return `

[질문 형태: 설명(Explain) - 매우 중요]
- '방법/절차/레시피/튜토리얼' 주제입니다. 오해 반박형 훅(“~라고 생각했겠지만…”)을 강제하지 마세요.
- 1) 목표/완성 상태(한 줄) → 2) 준비물/전제조건 → 3) 단계(순서) → 4) 주의/팁/실패 방지 순서로, 독자가 바로 따라할 수 있게 구성하세요.
- 안전/위생/법적 이슈가 있으면 해당 경고를 먼저 배치하세요.
- 불확실하거나 상황 의존적인 단계는 조건부로 쓰고, 단정하지 마세요.`
    }

    return `

[질문 형태: 설명(Explain) - 매우 중요]
- [오프닝 규칙: 일반 모드]
  - 첫 컷은 정의/목표 선언이 아니라 독자가 눈으로 볼 수 있는 상황, 대비, 작은 궁금증에서 시작하세요.
  - 용어 이름과 정의는 그 궁금증을 설명할 필요가 생긴 뒤에 붙이세요.
- 도입/초반(1~2컷)에서 반박형 프레이밍을 쓰지 마세요.
- 특히 아래 표현은 도입/초반(1~2컷)에서 금지:
    - "단순히 ~가 아니라", "단순한 ~가 아니라", "그것은 단순한 ~가 아니라, ~다", "A가 아니라 B", "많이들 ~라고 생각하지만", "사실은", "오해/착각"
- 오해/과장된 프레이밍 교정은 '필요할 때만' 중후반에 짧게 하세요. (해당 주제에 흔한 오해가 있거나 사용자가 요청한 경우)
- 기본 흐름: 눈앞의 장면/질문 → 관찰할 단서 → 이름 붙이기/원리 연결 → 직접 비교/예시 → 작은 정리(조건/주의 포함).`;
  })();

  const questionTypeInstructionEduCinematic = (() => {
    if (params.question_type === "compare") {
      return `

[질문 형태: 대결(Compare) - 매우 중요]
- 분석/해설/근거 나열을 하지 말고, 오직 장면(행동/대사/카메라/무드)으로만 전개하세요.
- A vs B의 대결을 4컷 구조(도입→긴장 상승→전환→클라이맥스)로 구성하세요.
- 승부/결말은 서사적으로 선택해도 되지만, 현실 사실처럼 단정하거나 특정 인물을 비방/모욕하지 마세요.
- 유혈/고어/잔혹 묘사는 금지(PG-13 수준의 액션).`
    }

    if (params.question_type === "review") {
      return `

[질문 형태: 상황극(Review) - 매우 중요]
- 평가표/해설로 "장점/단점"을 나열하지 말고, 장면(사용/테스트/실패/비교)로 보여주세요.
- 4컷 구조: 도입(사용 맥락) → 긴장(문제/불편) → 전환(해결/트릭) → 결론(조건부 추천/비추천 한 줄).
- 사실(스펙/수치/출시 등)을 단정하지 말고, 확인 가능한 범위에서만 암시하세요.`
    }

    return `

[질문 형태: 상황극(Explain) - 매우 중요]
- 개념/주제를 '설명'하지 말고, 핵심을 사건/행동/갈등으로 변환해 4컷으로 보여주세요.
- 정의/경계/요약 같은 메타 설명(해설/정리/교훈)은 금지입니다.
- 독자가 장면을 보고 스스로 이해하게 하세요.`;
  })();

  const questionTypeInstructionPureCinematic = (() => {
    if (params.question_type === "compare") {
      return `

[질문 형태: 시네마틱 대결(Compare) - 매우 중요]
- A vs B를 논설문으로 비교하지 말고, 라이벌의 충돌과 전략 변화로 보여주세요.
- 4컷 구조: 도입(판 깔기) → 압박(우위 싸움) → 반전(전략 전환) → 결판(강렬한 엔딩 훅).
- 승패는 서사적으로 선택해도 되지만, 특정 실존 인물/집단 비방은 금지합니다.
- 액션은 역동적으로, 유혈/고어/잔혹 묘사는 금지(PG-13).
- 비고어(PG-13) 범위의 타격/격투/충돌 연출은 허용됩니다. 액션을 무리하게 순화해 삭제하지 마세요.`;
    }

    if (params.question_type === "review") {
      return `

[질문 형태: 시네마틱 체험극(Review) - 매우 중요]
- 체크리스트형 장단점 나열 금지. 체험/추격/테스트/실패/역전의 장면으로 드러내세요.
- 4컷 구조: 만남(세팅) → 문제(위기) → 해법(트릭/선택) → 여운(조건부 선택 한 줄).
- 실존 브랜드/인물을 다룰 때는 명예훼손성 단정이나 허위 사실 단정을 피하세요.
- 필요한 경우 추격/대치/격투 같은 물리 액션을 포함해도 됩니다. 단, 고어/잔혹/유혈 과다는 금지합니다.`;
    }

    return `

[질문 형태: 시네마틱 스토리(Explain) - 매우 중요]
- "설명 만화"가 아니라 "이야기"로 전개하세요.
- 핵심 주제를 욕망/갈등/결정/대가가 있는 사건으로 변환해 4컷에 압축하세요.
- 메타 해설/요약/교훈/강의식 문장은 금지입니다.
${isActionTopic
        ? "- 주제가 액션/격투 계열이므로, 최소 2컷 이상에서 공방/회피/반격 같은 물리적 충돌을 실제 행동으로 보여주세요. (비고어 PG-13)"
        : "- 필요할 때는 추격/대치/격투 같은 물리적 액션을 허용하고, 잔혹 묘사 없이 긴장감으로 표현하세요."}`;
  })();

  const questionTypeInstructionKlingI2V = (() => {
    if (params.question_type === "compare") {
      return `

[질문 형태: I2V Compare - 매우 중요]
- 페이지마다 1프레임만 생성합니다. 전체 페이지 흐름으로 대결의 리듬(도입→긴장→전환→결말)을 설계하세요.
- 각 프레임은 모션 시작점이 분명해야 하며, scene/acting/camera를 구체적으로 작성하세요.
- dialogues는 음성 대사 기준으로 0~2줄, 화자 포함 형식("화자: 대사")을 사용하세요.
- 자막/화면 텍스트/말풍선 지시는 금지입니다.`;
    }
    if (params.question_type === "review") {
      return `

[질문 형태: I2V Review - 매우 중요]
- 페이지마다 1프레임만 생성합니다. 사용 맥락→문제→해결→여운 흐름을 페이지 간으로 분산하세요.
- 각 프레임은 인물의 행동/표정/카메라 변화가 보이도록 작성하세요.
- dialogues는 음성 대사 기준으로 0~2줄, 화자 포함 형식("화자: 대사")을 사용하세요.
- 자막/화면 텍스트/말풍선 지시는 금지입니다.`;
    }
    return `

[질문 형태: I2V Explain - 매우 중요]
- 페이지마다 1프레임만 생성합니다. 설명문 대신 장면 전개로 핵심을 전달하세요.
- 각 프레임은 다음 컷으로 이어질 동작/시선/카메라 의도를 포함해야 합니다.
- dialogues는 음성 대사 기준으로 0~2줄, 화자 포함 형식("화자: 대사")을 사용하세요.
- 자막/화면 텍스트/말풍선 지시는 금지입니다.`;
  })();

  const effectiveQuestionTypeInstruction = isKlingI2V
    ? questionTypeInstructionKlingI2V
    : isPureCinematic
      ? questionTypeInstructionPureCinematic
      : isEduCinematic
        ? questionTypeInstructionEduCinematic
        : questionTypeInstruction;

  const roleInstruction = params.character_role === "narrator"
    ? "주인공은 지식을 설명하는 '가이드(제 3자)'입니다. 장면마다 주인공은 설명을 하거나 상황을 지켜보는 관찰자로 등장하며, 실제 대상(예: 특정 인물, 세포 구조 등)은 주인공과 별개의 인물/물체로 묘사되어야 합니다."
    : "주인공은 직접 상황을 연기하는 '배우'입니다. 주인공이 그 주제의 핵심 인물이 되거나, 과학적 원리 그 자체가 되어 직접 행동하고 겪는 방식으로 묘사하세요.";

  const roleInstructionEduCinematic = params.character_role === "narrator"
    ? "주인공은 제3자 '관찰자/반응자'입니다. 지식 설명/해설은 금지이며, 주인공은 표정/행동으로 상황을 목격하고 반응하세요. 실제 대상(인물/사물)은 주인공과 별개의 인물/물체로 묘사되어야 합니다."
    : "주인공은 직접 상황을 연기하는 '배우'입니다. 설명 없이 행동으로 서사를 밀고 가세요. (장면 전개/갈등/선택/반격/클라이맥스)";

  const roleInstructionPureCinematic = params.character_role === "narrator"
    ? "주인공은 제3자 시점의 관찰자/촉발자입니다. 강의/해설은 금지하고, 표정·리액션·행동으로 사건의 리듬을 조절하세요."
    : "주인공은 서사의 중심 배우입니다. 욕망-갈등-결단-대가를 직접 겪으며 장면을 끌고 가세요.";

  const effectiveRoleInstruction = isPureCinematic
    ? roleInstructionPureCinematic
    : isEduCinematic
      ? roleInstructionEduCinematic
      : roleInstruction;

  const cast = Array.isArray(params.cast) ? params.cast : [];
  const castProtagonists = cast.filter((c) => c?.role === "protagonist");
  const castSupporting = cast.filter((c) => c?.role === "supporting");

  const freqLabel = (freq?: CharacterSpec["catchphrase_frequency"]) => {
    if (freq === "often") return "자주";
    if (freq === "sometimes") return "가끔";
    return "드물게";
  };

  const formatCharacterLine = (c: CharacterSpec): string => {
    const name = String(c.name || "").trim() || "이름없음";
    const appearance = String(c.appearance || "").trim();
    const persona = String(c.persona || "").trim();
    const catchphrase = String(c.catchphrase || "").trim();
    const parts: string[] = [name];
    if (appearance) parts.push(`외형/복장: ${appearance}`);
    if (persona) parts.push(`페르소나: ${persona}`);
    if (catchphrase) parts.push(`말버릇(${freqLabel(c.catchphrase_frequency)}): "${catchphrase}"`);
    return parts.join(" / ");
  };

  const castInstruction =
    castProtagonists.length > 0 || castSupporting.length > 0
      ? `

[캐스트(주연/조연) - 매우 중요]
- 아래 캐릭터들의 이름/외형/복장/말투/페르소나가 페이지 전체에서 일관되게 유지되어야 합니다.
- 말버릇은 '빈도'를 존중해 남발하지 마세요.
${isKlingI2V
        ? '- I2V 모드에서는 dialogues를 "음성 대사"로 작성하며, 화자 포함 형식("화자: 대사")을 권장합니다.'
        : "- 단, 대사(dialogues)에는 화자 이름 표시는 절대 넣지 마세요. (말풍선엔 순수 대사만)"}

주연(프로타고니스트):
${castProtagonists.length > 0 ? castProtagonists.map((c) => `- ${formatCharacterLine(c)}`).join("\n") : "- (없음)"}

조연(고정/반복 출연):
${castSupporting.length > 0 ? castSupporting.map((c) => `- ${formatCharacterLine(c)}`).join("\n") : "- (없음)"}`
      : "";

  const supportingCastInstruction = params.supporting_cast?.trim()
    ? `

[주요 등장인물(고정 캐스트) - 매우 중요]
- ${params.supporting_cast.trim()}
- 위 인물들은 장면에 등장할 때 이름/외형/복장/말투가 페이지 전체에서 일관되게 유지되어야 합니다.
${isKlingI2V
      ? '- I2V 모드에서는 dialogues를 "음성 대사"로 작성하며, 화자 포함 형식("화자: 대사")을 권장합니다.'
      : "- 단, 대사(dialogues)에는 화자 이름 표시는 절대 넣지 마세요. (말풍선엔 순수 대사만)"}
`
    : "";

  const characterConsistencyInstruction =
    characterConsistencyMode === "strict"
      ? `

[캐릭터 일관성 모드: 엄격(STRICT) - 최우선]
- 주인공(및 반복 출연 캐스트)의 얼굴/헤어/체형/복장(색/패턴/액세서리)은 페이지 전체에서 동일하게 유지하세요.
- 컷마다 "새로운 복장"을 임의로 창작하거나 랜덤 변형(색 바뀜/헤어스타일 바뀜/소품 추가)을 하지 마세요.
- 장면에 '갈아입음/변장/시간 점프' 등이 명시된 경우에만 변경을 허용합니다.
- scene/acting 작성에서도 위 전제를 자연스럽게 지키세요.`
      : "";

  const detailInstruction =
    params.detail_level === "brief"
      ? `

[디테일 레벨: BRIEF]
- 각 패널의 dialogues는 1~2줄 중심으로 간결하게 쓰세요.
- 정의부터 나열하지 말고, 눈앞의 장면과 핵심 원리만 남기세요. 예시는 꼭 필요한 하나만 씁니다.
- 불필요한 수식/반복을 피하세요.`
      : params.detail_level === "detailed"
        ? introStyle === "myth_busting" && !isAnyCinematic && params.question_type === "explain"
          ? `

[디테일 레벨: DETAILED / 오해 깨기]
- 각 패널의 dialogues는 1~3개의 자연스러운 발화 단위로 쓰세요. 먼저 의미가 완결되는 자연스러운 한 호흡을 만드세요.
- 그 한 호흡이 길어지면(한국어 약 32~38자 이상 / 영어 약 12~14단어 이상) 두 문장으로 억지 변환하지 말고, 독자가 하나의 설명 흐름으로 이어 읽을 수 있게 다음 컷의 이어지는 발화, 짧은 리액션, [narration] 박스로 넘기세요. 숫자를 맞추려고 문장을 억지로 자르지 마세요.
- 흔한 오해 1~2개를 myth→fact로 자연스럽게 교정하세요. (도입 훅 + 마무리 정리)
- 마지막에 복습(체크포인트)을 넣으세요.
- 단, 리서치 근거가 없는 단정은 금지(추가 리서치 필요 처리).`
          : `

[디테일 레벨: DETAILED]
- 각 패널의 dialogues는 1~3개의 자연스러운 발화 단위로 쓰세요. 먼저 의미가 완결되는 자연스러운 한 호흡을 만드세요.
- 그 한 호흡이 길어지면(한국어 약 32~38자 이상 / 영어 약 12~14단어 이상) 두 문장으로 억지 변환하지 말고, 독자가 하나의 설명 흐름으로 이어 읽을 수 있게 다음 컷의 이어지는 발화, 짧은 리액션, [narration] 박스로 넘기세요. 숫자를 맞추려고 문장을 억지로 자르지 마세요.
- 예시/비유를 포함하고, 필요할 때만 흔한 오해 0~2개를 교정하세요.
- 마지막에 복습(체크포인트)을 넣으세요.
- 단, 리서치 근거가 없는 단정은 금지(추가 리서치 필요 처리).`
        : `

[디테일 레벨: NORMAL]
- 각 패널의 dialogues는 1~2개의 자연스러운 말풍선 중심으로 쓰세요. 먼저 의미가 완결되는 자연스러운 한 호흡을 만드세요.
- 같은 화자의 한 흐름을 기계적으로 잘게 쪼개지 마세요. 한 호흡이 길어질 때만(한국어 약 32~38자 이상 / 영어 약 12~14단어 이상) 독자가 하나의 설명 흐름으로 이어 읽을 수 있게 다음 컷의 이어지는 발화/리액션으로 넘기세요. 숫자를 맞추려고 문장을 억지로 자르지 마세요.
- 장면/질문 → 관찰 → 원리 연결 → 예시/비유 → 안전한 요약 흐름을 유지하세요.
- 필요하면 흔한 오해를 짧게 교정하되, 오해 반박형 도입을 강제하지 마세요.`;

  const detailInstructionEduCinematic =
    params.detail_level === "brief"
      ? `

[디테일 레벨: BRIEF (Edu-Cinematic)]
- 컷당 dialogues는 0~2줄로 짧게 쓰세요.
- 대신 scene/acting은 구체적으로 작성하세요(스텝, 호흡, 시선, 손동작, 거리/각도 변화 등).
- 설명/해설/분석 문장은 금지입니다.`
      : params.detail_level === "detailed"
        ? `

[디테일 레벨: DETAILED (Edu-Cinematic)]
- 컷당 dialogues는 1~3개까지 허용하되, 리듬이 끊기지 않게 자연스러운 발화 단위로 쓰세요.
- scene/acting에 '블로킹(동선)'과 '타이밍(박자)'을 포함해 영화처럼 연출하세요.
- 설명/해설/분석 문장은 금지입니다.`
        : `

[디테일 레벨: NORMAL (Edu-Cinematic)]
- 컷당 dialogues는 1~3줄 중심으로 쓰세요.
- 컷마다 상황/감정/우위가 변해야 합니다(정지된 설명 컷 금지).
- 설명/해설/분석 문장은 금지입니다.`;

  const detailInstructionPureCinematic =
    params.detail_level === "brief"
      ? `

[디테일 레벨: BRIEF (Cinematic)]
- 컷당 dialogues는 0~2줄. 침묵/표정/시선 처리 비중을 높이세요.
- scene/acting에는 샷 크기, 동선, 박자, 전환 포인트를 명시하세요.
- 강의형/설명형 문장은 금지입니다.`
      : params.detail_level === "detailed"
        ? `

[디테일 레벨: DETAILED (Cinematic)]
- 컷당 dialogues는 2~4줄까지 가능하되, 대사는 캐릭터성 있는 구어체로 짧게 쓰세요.
- scene/acting에 카메라 렌즈감, 동선 블로킹, 리액션 비트를 명시해 촬영 콘티처럼 작성하세요.
- 장면 전환마다 갈등 축이 이동해야 합니다.`
        : `

[디테일 레벨: NORMAL (Cinematic)]
- 컷당 dialogues는 1~3줄 중심으로, 군더더기 없이 감정선에 맞춰 쓰세요.
- 각 컷에서 우위/긴장/선택 중 최소 1개는 변화해야 합니다.
- 설명/해설/분석 문장은 금지입니다.`;

  const detailInstructionKlingI2V =
    params.detail_level === "brief"
      ? `

[디테일 레벨: BRIEF (Kling I2V)]
- 프레임당 dialogues는 0~1줄의 짧은 음성 대사만 허용합니다.
- scene/acting/camera/mood를 우선 작성하고, 다음 프레임으로 이어질 모션 단서를 넣으세요.
- 자막/말풍선/화면 텍스트 지시는 금지입니다.`
      : params.detail_level === "detailed"
        ? `

[디테일 레벨: DETAILED (Kling I2V)]
- 프레임당 dialogues는 0~2줄의 짧은 음성 대사만 허용합니다.
- acting에 동선/속도/리듬을 구체적으로 넣고, camera에 샷 변화 의도를 명시하세요.
- 자막/말풍선/화면 텍스트 지시는 금지입니다.`
        : `

[디테일 레벨: NORMAL (Kling I2V)]
- 프레임당 dialogues는 0~2줄의 짧은 음성 대사만 허용합니다.
- scene/acting/camera 중심으로 모션 흐름이 보이게 작성하세요.
- 자막/말풍선/화면 텍스트 지시는 금지입니다.`;

  const effectiveDetailInstruction = isKlingI2V
    ? detailInstructionKlingI2V
    : isPureCinematic
      ? detailInstructionPureCinematic
      : isEduCinematic
        ? detailInstructionEduCinematic
        : detailInstruction;

  const audienceInstruction =
    params.audience_level === "kids"
      ? `

[독자 수준: 키즈(초등 저학년) - 매우 중요]
- 목표 독자: 초등 저학년(대략 7~10세). 초등 고학년/중학생 수준 어휘는 피하세요.
- 대사 규칙: 한 말풍선에는 한 사람이 자연스럽게 이어서 말할 수 있는 한 덩어리만 넣으세요. 너무 길게 설명하지 말고, 그렇다고 단어 조각처럼 잘게 쪼개지도 마세요.
- 용어 규칙: 어려운 용어/약어/영어를 최대한 쓰지 마세요. 꼭 필요하면 같은 말풍선 안에서 1줄로 뜻을 풀어쓰세요.
- 설명 흐름: "눈에 보이는 상황 → 아이가 품을 질문 → 쉬운 단서 하나 → 한 줄 복습" 순서를 유지하세요.
- 숫자/조건/비교는 최소화하고, 꼭 필요하면 작은 숫자(1~3)만 사용하세요.
- 공포/폭력/괴롭힘/선정성/비하 표현은 금지입니다.`
      : params.audience_level === "teen"
        ? `

[독자 수준: 중/고(틴) - 매우 중요]
- 쉬운 용어로 시작하되, 필요한 핵심 용어는 정확히 소개하고 바로 예시로 연결하세요.
- 과장/선동/혐오/비하/욕설은 금지입니다.
- 흥미 요소는 허용하지만, 정보의 정확성을 우선하세요.`
        : params.audience_level === "beginner"
          ? `

[독자 수준: 일반인(입문) - 매우 중요]
- 전문 용어는 최소화하고, 필요하면 '상황→이름 붙이기→예시'로 짧게 설명하세요.
- 핵심 메커니즘을 비유로 잡아주되, 비유의 한계(어디까지 맞는지)를 한 번 짚어주세요.`
          : params.audience_level === "expert"
            ? `

[독자 수준: 전문가(Expert) - 매우 중요]
- 지나친 단순화는 피하세요. 정확한 용어/경계를 사용하고, 핵심 트레이드오프/전제/한계를 명시하세요.
- 다만 컷당 텍스트 과밀은 금지이므로, 문장은 짧게 끊고 핵심만 남기세요.`
            : `

[독자 수준: 준전문(Intermediate) - 매우 중요]
- 정확도를 유지하되, 핵심 용어는 장면 속 필요가 생긴 뒤 짧게 이름 붙이고 단계적으로 쌓아가세요.
- 단정적 결론은 근거가 있을 때만, 없으면 조건부/UNKNOWN 처리하세요.`;

  const audienceInstructionEduCinematic =
    params.audience_level === "kids"
      ? `

[독자 수준: 키즈(초등 저학년) - 매우 중요 (Edu-Cinematic)]
- 대사는 아주 짧게(한 문장), 어려운 단어/약어/영어는 피하세요.
- 설명/해설은 금지이므로, 소품(레고/풍선/물컵 등)과 행동으로 뜻이 보이게 연출하세요.
- 과격한 폭력/공포/괴롭힘 묘사는 피하고, 안전한 범위의 긴장감만 허용합니다.`
      : params.audience_level === "teen"
        ? `

[독자 수준: 중/고(틴) - 매우 중요 (Edu-Cinematic)]
- 속도감 있게 전개하되, 욕설/비하/혐오/선정성은 금지입니다.
- 과도한 잔혹/유혈 묘사는 금지입니다.`
        : params.audience_level === "expert"
          ? `

[독자 수준: 전문가(Expert) - 매우 중요 (Edu-Cinematic)]
- 과도한 친절한 설명은 금지입니다. 대사는 짧고 현실적으로, '서브텍스트'로 전달하세요.
- 컷 구성은 더 영화적으로(카메라/무드/블로킹) 정교하게.`
          : `

[독자 수준: 일반 - 매우 중요 (Edu-Cinematic)]
- 대사는 짧고 자연스럽게, 설명 없이 맥락이 느껴지게 쓰세요.
- 컷마다 행동/감정 변화가 분명해야 합니다.`;

  const audienceInstructionPureCinematic =
    params.audience_level === "kids"
      ? `

[관람 연령 톤: 키즈(초등 저학년) - 매우 중요 (Cinematic)]
- 모험/우정/발견 중심의 안전한 긴장으로 전개하세요.
- 대사는 쉬운 단어의 짧은 문장으로 제한하고, 폭력/공포 강도는 낮게 유지하세요.
- 교훈을 직접 말하지 말고 행동 결과로 암시하세요.`
      : params.audience_level === "teen"
        ? `

[관람 연령 톤: 틴 - 매우 중요 (Cinematic)]
- 속도감 있는 장르 문법(추격, 반전, 감정 충돌)을 허용하되 혐오/비하/선정성은 금지입니다.
- 액션은 강렬하게, 고어/잔혹/유혈 과다는 금지입니다.`
        : params.audience_level === "expert"
          ? `

[관람 연령 톤: 전문가 - 매우 중요 (Cinematic)]
- 서브텍스트와 여백을 적극 활용하세요. 대사는 짧되 함의는 깊게.
- 세계관 디테일과 인물 동기를 촘촘히 연결하세요.`
          : `

    [관람 연령 톤: 일반 - 매우 중요 (Cinematic)]
- 대사는 자연스럽고 짧게, 장면의 감정 흐름이 먼저 보이게 쓰세요.
- 컷마다 행동/감정/관계의 변화가 분명해야 합니다.
- 액션 장면이 필요한 주제라면 공방/추격/충돌을 회피하지 말고, 비고어(PG-13) 선에서 선명하게 연출하세요.`;

  const effectiveAudienceInstruction = isPureCinematic
    ? audienceInstructionPureCinematic
    : isEduCinematic
      ? audienceInstructionEduCinematic
      : audienceInstruction;

  const deliveryInstruction = params.delivery_style
    ? `

[말투 & 제스처 - 매우 중요]
- 선택된 프리셋: ${params.delivery_style.preset_label}
- 지침: ${params.delivery_style.instruction}
- 적용 규칙(출력 강제):
  - dialogues: 말투/어투는 반드시 프리셋을 따르고, 컷 사이에서 톤이 흔들리지 않게 유지하세요.
  - dialogues: 프리셋을 따르더라도 한 가지 종결어미에 고정하지 마세요. 특히 친절한 설명 톤을 "~요/~예요/~해요" 반복으로만 처리하면 실패입니다.
  - acting: 각 패널마다 '표정/몸짓/손동작'을 최소 1개 이상 구체적으로 적으세요. (예: 고개 끄덕임, 손바닥 펼쳐 강조, 분필로 칠판 두드리기 등)
  - 금지: 제스처/연기 지시를 dialogues 텍스트 안에 괄호로 끼워넣지 마세요. (괄호/무대지시는 acting에만 작성)
- 우선순위: 독자 수준 지침이 말투/제스처 지침보다 항상 우선입니다.
- 안전 규칙: 욕설/비하/혐오표현/노골적 성적 묘사/괴롭힘 조장은 절대 금지입니다.`
    : isPureCinematic
      ? `

[말투 & 제스처 - 기본(Pure Cinematic)]
- 말투는 장르 톤에 맞는 자연스러운 구어체로 유지하세요.
- 대사는 감정선/목표/갈등이 드러나게 짧게 쓰고, 설명문은 금지합니다.
- acting에는 표정/몸짓/속도감(멈춤/폭발/주저)을 구체적으로 작성하세요.`
      : `

[말투 & 제스처 - 기본]
- 말투는 한국어 만화/학습만화 말풍선처럼 자연스러운 구어체로 쓰세요. 독자에게 실제로 옆에서 말해주는 느낌을 우선하세요.
- 특정 어미(~해요/~합니다/~이다 등)에 고정하지 말고, 장면과 캐릭터 감정에 맞춰 자연스럽게 섞으세요.
- 과장된 비하/욕설/혐오/선정성은 금지입니다.`;

  const researchMode: ResearchMode = params.research?.mode ?? "auto_gemini";
  const usingProvidedResearch = researchMode === "user" || researchMode === "auto_digest";
  const shouldUsePlannerWebSearch = researchMode === "auto_gemini";
  const researchNotes = params.research?.pack?.notes?.trim();
  const researchSources = params.research?.pack?.sources || [];
  const isPaperStoryResearchPack = Boolean(researchNotes && /\[PAPER STORY UNITS\]/.test(researchNotes));

  const debugChunks: PlannerDebugChunk[] = [];

  const researchInstruction = usingProvidedResearch
    ? `

[사용자 제공 리서치 팩 - 최우선]
- 아래 리서치 팩에 포함된 정보만 사용하세요. 모르는 내용은 추측하지 말고 "UNKNOWN"으로 표시하세요.
- 리서치 팩에 근거가 없는 주장/수치/인명/연도/원인-결과 관계를 임의로 만들지 마세요.
- 논문만화 리서치 팩에 [PAPER STORY UNITS]가 있으면 [LEARNING UNITS]보다 우선하세요. 각 unit은 "이 페이지는 여기까지만"이라는 약속입니다. allowed_content, forbidden_content, next_page_tease를 페이지 아웃라인과 최종 대사에 반드시 반영하세요.
- 논문만화에서는 1페이지가 제일 중요합니다. 1페이지는 배경의 공기와 눈앞의 상황만 보여주고, 전문 데이터 부족/비용/보안/개인정보/연구 질문/방법/결과/기여/한계는 말하지 마세요.
- 논문만화 1페이지에서는 논문에 없는 가짜 예시를 새로 만들지 마세요. 고양이 이야기, 상자, 창고, 버튼, 게임, 동화 같은 임의의 비유 대신 실제 연구 배경의 자료, 사람, 도구, 화면을 보여주세요.
- 최종 페이지 생성에서 [이번 페이지에서만 볼 재료 - 논문만화]가 함께 오면, 그 블록이 가장 마지막 약속입니다. 전체 리서치 팩을 떠올려 뒤 페이지 정보를 앞당기지 마세요.
- 학습만화에서 리서치 팩의 [FRAMING]이 [LEARNING UNITS]와 충돌하면 [LEARNING UNITS]를 우선하세요.
- "첫 장면은 정의로 바로 시작", "첫 말풍선은 ○○란..." 같은 FRAMING은 제작 메모로만 참고하고, 실제 1페이지 오프닝은 상황/대비/궁금증에서 시작하도록 재구성하세요.
- 만약 리서치 팩이 비어 있거나 불충분하면, 가장 안전한 범위(일반 원리/정의 수준)에서만 구성하세요.`
    : "";

  const researchInstructionEduCinematic = usingProvidedResearch
    ? `

[리서치 팩 사용(참고) - Edu-Cinematic]
- 리서치 팩은 '배경/디테일/설정 재료'로 참고하되, 설명형 보고서로 재구성하지 마세요.
- 리서치 팩에 없는 구체적 사실(연도/수치/실존 사건)을 사실처럼 단정해서 추가하지 마세요.
- 대결/사건/승패 등 서사는 가상의 what-if로 창작할 수 있습니다. (단, 특정 인물 비방/모욕/명예훼손성 설정 금지)`
    : "";

  const researchInstructionPureCinematic = usingProvidedResearch
    ? `

[리서치 팩 사용(월드빌딩 참고) - Cinematic]
- 리서치 팩은 분위기/디테일/소재 확장용으로만 사용하세요.
- 사실 나열형 보고서로 재작성하지 말고, 장면 안의 단서/소품/행동으로 녹여내세요.
- 실존 개인/집단에 대한 비방·허위사실 단정·명예훼손성 서사는 금지입니다.`
    : "";

  const effectiveResearchInstruction = isPureCinematic
    ? researchInstructionPureCinematic
    : isEduCinematic
      ? researchInstructionEduCinematic
      : researchInstruction;

  const frameworkInstructionLearning = params.audience_level === "kids"
    ? `

[시나리오 철학: Kids-First (쉽게)]
1. 한 페이지마다 '한 가지'만 가르치세요.
2. 페이지 구조: 눈에 보이는 장면 → 아이가 할 법한 질문 → 쉬운 단서 하나 → 작은 "아하" 또는 복습.
3. 추상적인 말 대신, 눈에 보이는 상황/행동/물건으로 설명하세요.`
    : `

[시나리오 철학: The Deep-Dive Framework]
1. 정의부터 말하지 말고, 독자가 먼저 이상함/차이/필요를 느끼게 하세요.
2. 한 페이지는 정보 묶음이 아니라 독자의 생각 한 걸음입니다.
3. 비유는 설명을 대신하는 장면으로 쓰고, 말풍선으로 길게 해설하지 마세요.
4. 페이지 안의 컷 흐름은 장면/질문 → 관찰 → 원리의 단서 → 작은 통찰을 따르세요.`;

  const frameworkInstructionEduCinematic = `

[시나리오 철학: Cinematic Show-Don’t-Tell]
1. 설명하지 말고 보여주세요. (행동/대사/표정/카메라/무드)
2. 컷마다 '변화'가 있어야 합니다. (정보/감정/위치/우위 변화)
3. 4컷 구조: 도입(장소/목표) → 긴장 상승(갈등/리스크) → 전환(반격/결단) → 클라이맥스(승부/훅).
4. 메타 해설/정리/교훈/분석 문장은 금지입니다.
5. 유혈/고어/잔혹 묘사는 금지(PG-13).`;

  const frameworkInstructionPureCinematic = `

[시나리오 철학: Cinematic Story Forge]
1. 당신은 영화/애니메이션/만화/실사 문법을 넘나드는 탑티어 스토리 작가입니다.
2. 설명이 아니라 장면으로 말하세요. (행동/대사/시선/소품/카메라)
3. 4컷 구조: 세팅(욕망/목표) → 충돌(방해/위기) → 전환(선택/대가) → 엔딩 훅(여운/다음 갈등).
4. 컷마다 긴장도 또는 관계 역학이 반드시 변해야 합니다.
5. 교훈/요약/강의체 문장은 금지, 유혈/고어/잔혹 묘사는 금지(PG-13).
${isActionTopic
      ? "6. 이 주제는 액션/격투 장르 성격이 강하므로 공방/회피/반격의 물리 액션을 최소 2컷 이상 실제로 보여주세요."
      : "6. 추격/대치/격투 등 물리 액션은 비고어(PG-13) 범위에서 허용됩니다. 액션을 불필요하게 회피하지 마세요."}`;

  const frameworkInstructionKlingI2V = `

[시나리오 철학: Kling I2V Storyboard]
1. 한 페이지는 하나의 핵심 프레임(1컷)입니다.
2. 페이지 간 연결로 도입 → 긴장 → 전환 → 결말의 리듬을 설계하세요.
3. 각 프레임에서 scene/acting/camera/mood를 구체적으로 작성하세요.
4. dialogues는 화면 텍스트가 아니라 "음성 대사" 기준으로 0~2줄의 짧은 구어체로 작성하세요.
5. dialogues는 화자 포함 형식을 권장합니다. (예: "주인공: 지금 시작하자")
6. 자막/화면 텍스트/말풍선 지시를 dialogues에 넣지 마세요.`;

  const frameworkInstructionWebtoon = `

[시나리오 철학: 한국 웹툰 모바일 페이지 — 다이나믹 레이아웃]
1. 각 스트립마다 장면에 맞춰 패널 수(2~5)와 높이 가중치를 결정하세요.
2. 기본값은 동적 webtoon_layout입니다. 정적 앵커 템플릿(template_id)은 정말 필요한 페이지에서만 최대 2페이지까지 허용합니다.
   - hero 도입: webtoon_hero_stack
   - 호흡/정보 정리: webtoon_stack_3 또는 webtoon_stack_4
   - 단일 임팩트/엔딩: webtoon_impact
3. 정적 앵커 페이지를 선택했다면 template_id만 사용하고 webtoon_layout은 생략하세요. 동적 페이지를 선택했다면 webtoon_layout만 사용하세요. 특별한 이유가 없다면 template_id는 비우세요.
4. 각 동적 페이지마다 webtoon_layout.core_pattern을 반드시 1개 선택하세요:
   - stack_focus: 넓은 컷 1개 + 좁은 리액션 컷들을 섞는 기본형
   - hero_drop: 큰 도입 컷 뒤에 좁은 보조/리액션 컷
   - split_row: 한 줄 정도는 컴팩트한 좌우 분할 컷
   - stair_step: 좌우 오프셋 계단형 흐름
   - closeup_pulse: 넓은 컷 사이에 좁은 클로즈업/감정 컷
   - impact_tail: 작은 빌드업 뒤 큰 클라이맥스 컷
   - vertical_panorama: 세로 깊이감이 중요한 공간/낙하/거대 스케일 컷
   - void_reveal: 큰 여백 뒤에 리빌이 떨어지는 지연 공개형
   - continuity_chain: 하나의 사건을 여러 미세 비트로 이어붙이는 연속형
   - motion_runway: 스크롤 방향으로 속도감이 흐르는 액션 런웨이형
   - one_point_charge: 원근 수렴과 돌진감이 중심인 원포인트 구도형
5. webtoon_layout.modifiers는 0~2개만 선택하세요:
   - borderless_open / inset_closeup / diagonal_cut / overlap_bleed / long_pause_gap / micro_reaction
6. webtoon_layout.gap_profile은 tight|balanced|breathing|dramatic 중 하나로 정하세요.
7. webtoon_layout.focus_panel_index는 시각적으로 가장 강조할 패널 번호입니다.
8. 높이 가중치(height_weight) 가이드:
   - dialogue(대화): 2 / action(액션): 4 / emotional(감정): 3
   - establishing(배경설정): 3 / transition(전환): 1
   - impact(임팩트/스플래시): 5 / closeup(클로즈업): 2
9. webtoon_layout.panel_heights 배열과 panels 배열의 길이가 반드시 panel_count와 같아야 합니다.
10. 실제 한국 웹툰처럼 패널 높이에 변화를 주세요:
   - 대화 장면 → 짧은 패널 2~3개
   - 액션/감정 클라이맥스 → 큰 패널 1~2개
   - 드라마틱 반전 → impact 풀블리드 패널
11. 기본 흐름은 모바일 웹툰 페이지이지만, split_row / stair_step / vertical_panorama / void_reveal / continuity_chain / motion_runway / one_point_charge / inset_closeup 같은 변주를 써서 세로 읽기 리듬을 만드세요.
12. 대화/리액션/클로즈업 패널은 전폭 가로띠보다 좁은 portrait-leaning 컷을 자주 사용하세요.
13. 클리프행어나 감정 고조 장면은 focus_panel_index 또는 스트립 마지막 패널에 배치하세요.
14. 같은 폭의 전폭 가로 직사각형이 3번 연속 반복되지 않게 하세요.
15. 패널 사이 여백은 단순 분리가 아니라 호흡 연출입니다. reveal 직전에는 breathing/dramatic gap을 적극 사용하세요.
16. 모든 웹툰 페이지에는 scroll_choreography를 함께 작성하세요. 이것은 당장 렌더링 좌표가 아니라 다음 단계의 세로 웹툰 연출 악보입니다.
17. scroll_choreography.canvas_size는 항상 "1024x3072"로 설정하세요.
18. scroll_choreography.choreography_pattern은 ${WEBTOON_SCROLL_PATTERN_DOC} 중 하나입니다.
   - dialogue_air: 대화/말풍선 공간/작은 리액션 중심
   - emotional_pause_reveal: 긴 침묵, 흰 여백, 아래쪽 리빌
   - action_runway: 스크롤 방향의 액션 가속과 짧은 연속 컷
   - vertical_panorama: 높이/낙하/거대 공간감
   - micro_reaction_chain: 눈/손/표정 같은 짧은 반응 연쇄
   - impact_drop: 아래로 스크롤한 뒤 크게 떨어지는 임팩트 컷
19. scroll_choreography.beats는 2~6개로 작성하고, kind는 ${WEBTOON_SCROLL_BEAT_KIND_DOC} 중 하나입니다.
20. beats에는 panel만 반복하지 마세요. 4개 이상의 beats라면 pause_space, bubble_space, borderless_scene, reaction_micro, transition_air 중 최소 2개 이상을 반드시 포함하세요.
21. panel이 3개 이상 연속되면 실패입니다. 중간에 bubble_space, transition_air, reaction_micro 같은 비패널 구간을 넣어 리듬을 끊으세요.
22. 비패널 구간의 height_weight 합이 전체의 최소 35% 정도가 되게 하세요. 실제 한국 웹툰처럼 여백/침묵/무테 장면도 세로 길이를 차지해야 합니다.
23. 각 beat에는 width_profile(${WEBTOON_SCROLL_WIDTH_PROFILE_DOC}), x_position(${WEBTOON_SCROLL_X_POSITION_DOC}), shape_style(${WEBTOON_SCROLL_SHAPE_STYLE_DOC}), vertical_role(${WEBTOON_SCROLL_VERTICAL_ROLE_DOC}), scroll_distance(${WEBTOON_SCROLL_DISTANCE_DOC})를 작성하세요.
24. full width만 반복하지 마세요. medium/narrow/tiny 컷을 최소 2개 섞고, x_position이 전부 center가 되지 않게 left/right/drift를 섞으세요.
25. 모든 beat가 rect/soft_border이면 실패입니다. borderless, diagonal, inset, overlap 중 최소 1개 이상을 포함하세요.
26. vertical_role에는 pause/drop/reveal 중 최소 1개 이상, scroll_distance에는 long/very_long 중 최소 1개 이상을 포함하세요.
27. 완전 랜덤이 아니라 장면 목적에 맞는 변주를 선택하세요. 대화는 dialogue_air/micro_reaction_chain, 감정/리빌은 emotional_pause_reveal/impact_drop, 액션은 action_runway/vertical_panorama를 우선합니다.`;

  const frameworkInstructionManga = `

[시나리오 철학: 일본 만화 페이지 구성]
1. 한 페이지(${panelsPerPage}컷)에 기승전결의 한 단락을 압축하세요.
2. 읽기 순서: 오른쪽→왼쪽, 위→아래를 엄격히 지키세요. panel_index 1이 오른쪽 상단입니다.
3. 만화적 연출을 적극 활용하세요: 스피드 라인, 집중선, 리액션 컷, 극적 클로즈업, 이모션 이펙트.
4. 패널 크기의 변화로 리듬감을 만드세요 — 중요한 장면은 큰 패널, 리액션은 작은 패널.
5. camera 지시에 만화 특유의 앵글을 포함하세요: 극적 로우앵글, 버드아이뷰, 더치앵글, 익스트림 클로즈업.
${mangaColorMode === "bw" ? "6. 흑백 스크린톤 스타일입니다. scene 묘사에 톤/명암/질감 힌트를 포함하세요." : "6. 풀컬러 만화 스타일입니다. 선명한 셀 셰이딩과 생동감 있는 색채를 활용하세요."}`;

  const frameworkInstruction = isKlingI2V
    ? frameworkInstructionKlingI2V
    : isWebtoon
      ? frameworkInstructionWebtoon
      : isManga
        ? frameworkInstructionManga
        : isPureCinematic
          ? frameworkInstructionPureCinematic
          : isEduCinematic
            ? frameworkInstructionEduCinematic
            : frameworkInstructionLearning;

  const learningLayoutProInstruction = isLearningComicPro ? `

[학습만화 프로 레이아웃 디렉팅]
- 페이지 크기는 유지하되, 페이지마다 학습 목적에 맞는 3~7컷 template_id와 learning_layout_intent를 함께 작성하세요.
- 프로 레이아웃은 4컷 고정이 아닙니다. 먼저 이 페이지에 필요한 장면 비트 수를 정하고, 그 컷 수와 정확히 같은 template_id를 고르세요.
- 선택한 template_id의 컷 수와 panels 배열 길이는 반드시 같아야 합니다. 4컷만 만들었다면 5~7컷 템플릿을 고르지 마세요.
- learning_layout_intent.role은 ${LEARNING_LAYOUT_ROLE_DOC} 중 하나입니다.
  - definition: 개념 정의/핵심 원리
  - comparison: 차이/대조/전후 비교
  - process: 순서/과정/흐름
  - reveal: 오해 해소/정답 공개/결론 임팩트
  - quiz: 질문/생각해보기/선택지
  - summary: 요약/정리
  - misconception: 흔한 오해를 깨는 페이지
  - example: 사례/비유/적용 예시
  - debate: 주장/반박/종합이 오가는 토론형 페이지
  - investigation: 단서/근거를 따라가는 탐정형 자료 해석 페이지
  - timeline: 변화/역사/순서를 압축하는 몽타주 페이지
  - cause_effect: 원인→원리→결과→예외/주의를 잇는 페이지
  - cutaway: 단면도/구조도와 장면을 함께 보여주는 원리 설명 페이지
  - experiment: 시도→실패/예상 밖 결과→진단→원리로 가는 페이지
- visual_flow는 ${LEARNING_LAYOUT_FLOW_DOC} 중 하나, density는 ${LEARNING_LAYOUT_DENSITY_DOC} 중 하나입니다.
- focus_panel_index는 선택한 템플릿 컷 수 안에서 가장 중요한 컷 번호입니다. 마지막 깨달음/반전이면 마지막 컷, 도입 이미지가 중요하면 1을 우선하세요.
- template_id 선택 가이드:
  - comparison/left_right_compare: quad_asymmetric, masonry_alt, classic_grid
  - debate/collision: debate_collision_5, myth_fact_split_5
  - process/top_to_bottom: process_cutaway_6, wide_strips, sandwich
  - reveal/quiz/setup_to_punchline: quiz_tension_6, impact_reveal_3, hero_bottom, inset_focus
  - definition/hero_focus: cinematic_definition_3, hero_top, classic_grid
  - misconception/action_diagonal: misconception_crack_5, diagonal_v2, diagonal_split_v1
  - investigation/evidence_stack: investigation_board_7, zoom_cascade_5
  - timeline/timeline_burst: timeline_burst_6
  - cause_effect/cause_chain: cause_effect_chain_6
  - cutaway/cutaway_focus: process_cutaway_6
  - experiment: experiment_failure_7
  - example/zoom_in: zoom_cascade_5, triptych_hero, inset_focus, masonry_alt
- template_reason에는 왜 그 템플릿이 학습 흐름에 맞는지 한 문장으로 적으세요.` : "";

  const learningComicDialogueArcInstruction = isLearningComic && !isAnyCinematic ? `

[학습만화 페이지 대화 아크 - 최우선]
- 각 페이지는 "패널별 독립 설명문 4개"가 아니라, 하나의 짧은 설명 장면처럼 읽혀야 합니다.
- 페이지의 panels를 쓰기 전에 먼저 페이지 안의 대화 흐름을 정하세요: 첫 장면 → 독자 질문 → 관찰 → 원리/이름 연결 → 작은 깨달음 중 필요한 기능을 배치합니다. 모든 기능을 억지로 다 넣을 필요는 없습니다.
- 각 패널의 dialogues는 서로 다른 문장 기능을 가져야 합니다. 질문, 관찰, 짧은 반응, 원인/결과 연결, 다음 행동 제안, 확인/정리 중 장면에 맞게 섞으세요.
- 모든 컷이 "A는 B예요" 같은 정의문으로 끝나면 실패입니다. 각 컷은 앞 컷의 시각 정보나 다음 컷의 행동과 이어져야 합니다.
- 설명은 한 캐릭터가 계속 강의하듯 다 말하지 않게 하세요. 가능한 경우 질문/리액션/행동/나레이션으로 정보 부담을 나누세요.
- 설명자/가이드의 말만 이어 붙여 읽었을 때 발표문, 설명서, 순서표처럼 들리면 실패입니다. 생활 속 질문이나 관찰에서 시작해, 현상이 눈앞에서 이어지는 말 흐름으로 다시 쓰세요.
- 불필요한 새 인물을 만들 필요는 없습니다. 보조 캐릭터가 없으면 주인공이 눈앞의 현상을 관찰하고 반응하며 다음 행동으로 이어가면 됩니다.
- 아웃라인/기획 지시를 캐릭터가 직접 말하게 하지 마세요. "아직 원리를 다 말하지 말고", "먼저 이 장면을 보세요", "이번 페이지는 상황을 느끼는 페이지입니다" 같은 내부 규칙 문장은 dialogues에 절대 쓰지 마세요.
- panels 출력에는 별도 필드를 추가하지 말고, 이 대화 아크가 scene/acting/dialogues/camera에 자연스럽게 드러나게 작성하세요.` : "";

  const learningComicScriptDistributionInstruction = isLearningComic && !isAnyCinematic ? `

[학습만화 전체 스크립트 분배 - 최우선]
- 한 페이지는 여러 개념을 압축 설명하는 슬라이드가 아니라, 하나의 학습 행동만 담당합니다.
- 정의/뜻/사용 상황/예문/해석/주의점/요약을 한 페이지에 모두 넣지 마세요.
- 각 페이지의 목표는 "많이 알려주기"가 아니라 "상황 느끼기 / 필요성 발견 / 이름 붙이기 / 예문 확인 / 비교하기 / 오해 바로잡기 / 연습하기 / 정리하기" 중 하나에 가깝게 잡으세요.
- 1페이지는 기본적으로 정의문 오프닝이 아니라 상황/대비/궁금증 오프닝이어야 합니다. "조리개란...", "as if란...", "무지개란..."처럼 용어 정의로 첫 말풍선을 시작하면 실패입니다. 먼저 독자가 볼 수 있는 현상이나 곤란함을 만들고, 이름 붙이기는 다음 컷이나 다음 페이지로 넘기세요.
- 리서치 팩에 [LEARNING UNITS]가 있으면 그 순서를 페이지 분배의 뼈대로 삼으세요. [FRAMING]의 문구가 정의로 시작하라고 해도, [LEARNING UNITS]가 상황/필요성/이름 붙이기 순서라면 그 순서를 우선하세요.
- 목표 페이지 수가 learning unit 수와 같거나 더 많으면, 원칙적으로 unit 하나를 한 페이지에 배정하세요. 목표 페이지 수가 더 적을 때만 인접한 저부담 unit 2개까지 합칠 수 있고, 1페이지에 3개 이상의 학습 행동을 합치면 실패입니다.
- 논문만화에 [PAPER STORY UNITS]가 있으면 그 순서를 페이지 분배의 최우선 뼈대로 삼으세요. 각 unit은 "이 페이지는 여기까지만"이라는 약속입니다. allowed_content 안에서만 말하고, forbidden_content에 적힌 내용은 대사/나레이션/화면 텍스트/scene 정보로도 앞당기지 마세요.
- 논문만화 첫 페이지는 특히 느리게 시작하세요. 공개된 자료가 많다, 모델이 많이 볼수록 배울 기회가 생긴다 정도만 보여줘도 충분합니다. 전문 영역 자료가 부족하다, 개인정보, 비용, 보안 같은 말은 다음 페이지 이후의 말입니다.
- 논문만화 첫 페이지에서는 임의의 비유를 새로 만들지 마세요. 가짜 동물 이야기, 상자/창고/버튼/게임 같은 장치가 나오면 독자가 논문 배경을 놓칩니다. 실제 논문이 다루는 자료와 화면을 보여주세요.
- next_page_tease는 페이지 끝에서 다음 궁금증을 여는 용도입니다. 같은 페이지에서 그 답을 설명하면 실패입니다.
- 절차/방법 주제는 재료, 이유, 핵심 동작, 변화, 주의점, 마무리를 필요하면 별도 페이지로 나누세요. 한 페이지에 재료 목록과 조리/작동 원리와 주의점을 동시에 넣으면 실패입니다.
- 영어/언어 문법 주제는 "개념 이름 → 뜻"으로 시작하지 말고, 실제로 그 표현이 필요한 상황을 먼저 만들고 나중에 이름을 붙이세요.
- 카메라/과학/원리 주제도 "용어 이름 → 정의"로 시작하지 마세요. 예: 조리개 페이지는 먼저 같은 장면의 밝기/배경 흐림 차이를 보게 하고, 그 차이를 설명할 필요가 생긴 뒤 '조리개'라는 이름을 붙이세요.
- 페이지 아웃라인을 만들 때 각 페이지에 learning_action을 하나만 정하세요. content_summary는 그 learning_action을 수행하는 데 필요한 정보만 담아야 합니다.
- reader_question/opening_scene/page_reveal/dialogue_goal/page_speech_flow/dont_explain_yet/allowed_content/forbidden_content/next_page_tease가 있으면 반드시 따르세요. 특히 dont_explain_yet과 forbidden_content에 적힌 정보는 해당 페이지에서 대사/나레이션/화면 텍스트/장면 정보로 먼저 말하지 마세요.
- 만약 한 페이지의 content_summary에 서로 다른 학습 행동이 2개 이상 섞이면, 그 페이지는 과밀입니다. 가능한 경우 페이지를 나눠야 하며, 이미 페이지 수가 고정되어 있다면 덜 중요한 설명/예외/요약을 다음 페이지나 생략 대상으로 보내세요.
- page_speech_flow는 그대로 복붙할 대본이 아니라, 이 페이지의 말이 자연스럽게 흘러가는 느낌입니다. 패널로 나눌 때는 말투를 더 자연스럽게 다듬어도 되지만, 뒤 페이지 정보를 끌어오면 안 됩니다.
- learning_action, reader_question, opening_scene, page_reveal, dialogue_goal, page_speech_flow, dont_explain_yet, allowed_content, forbidden_content, next_page_tease, density_note는 내부 제작 메모입니다. 이 단어들이나 그 뜻풀이를 캐릭터 대사, 나레이션, 화면 텍스트로 노출하지 마세요.
- 말로 설명할 양을 줄일 수 있으면 그림, 비교 컷, 표정, 행동, 화면 텍스트로 넘기세요.` : "";

  const systemIntro = isPureCinematic
    ? "당신은 영화/애니메이션/만화/실사를 넘나드는 세계 최고 수준의 시네마틱 스토리 작가입니다."
    : isEduCinematic
      ? "당신은 교육적 핵심을 잃지 않으면서 영화/드라마처럼 장면을 연출하는 일류 Edu-Cinematic 작가입니다."
      : params.audience_level === "kids"
        ? "당신은 초등 저학년도 이해할 수 있게 아주 쉽게 풀어주는 일류 교육 만화 기획자입니다."
        : "당신은 복잡한 원리의 '본질'을 꿰뚫어 보는 일류 교육 만화 기획자입니다.";

  const planMetaInstruction = (() => {
    if (isPureCinematic) {
      if (params.question_type === "compare") {
        return `

[plan_meta 작성 규칙 - Cinematic]
- core_insight: 대결의 핵심 갈등축과 결판 조건을 1문장으로 요약하세요.
- rationale: 장면 배치/리듬/클라이맥스 설계 이유를 1~2문장으로 설명하세요.`;
      }

      if (params.question_type === "review") {
        return `

[plan_meta 작성 규칙 - Cinematic]
- core_insight: 체험극에서 드러난 선택 포인트(무엇을 택할지)를 1문장으로 요약하세요.
- rationale: 위기-전환-여운의 흐름을 어떻게 설계했는지 1~2문장으로 설명하세요.`;
      }

      return `

[plan_meta 작성 규칙 - Cinematic]
- core_insight: 주인공의 욕망/갈등/변화가 드러나는 한 줄 로그라인으로 작성하세요.
- rationale: ${panelsPerPage}컷 안에서 감정선과 전환을 배치한 이유를 1~2문장으로 설명하세요.`;
    }

    if (params.question_type === "compare") {
      return `

[plan_meta 작성 규칙]
- core_insight: 비교의 핵심 기준(비교축)과 조건부 결론을 1문장으로 요약하세요. ("승자/패자" 단정 금지)
- rationale: 구성/페이지 수 선택 이유를 1~2문장으로 설명하세요.`;
    }

    if (introStyle === "myth_busting") {
      return `

[plan_meta 작성 규칙]
- core_insight: 1문장. 오해(짧게) → 정정(핵심 사실) 흐름이 드러나게 쓰세요. (조롱/비하 금지)
  - 예시: "오해: X / 사실: Y"
- rationale: 구성/페이지 수 선택 이유를 1~2문장으로 설명하세요.`;
    }

    return `

[plan_meta 작성 규칙]
- core_insight: 1문장. 독자가 붙잡을 핵심 변화나 관찰 포인트를 긍정문으로 작성하세요.
  - 형식 추천: "처음에는 X처럼 보이지만, 장면을 따라가면 Y를 알게 된다", "<주제>는 장면 속에서 ...로 이해된다"
  - 금지(특히): "그것은 단순한 ~가 아니라, ~다" 같은 not just A but B 직역/대조 문장, "X가 아니라/아니다" 대비형, "단순", "사실은", "많이들", "오해/착각", "하지만"
- rationale: 구성/페이지 수 선택 이유를 1~2문장으로 설명하세요.`;
  })();

  const languageInstruction =
    params.language === "en"
      ? `

[언어 규칙 - 매우 중요]
- 출력 텍스트(chapter_title/scene/acting/dialogues/camera/mood)는 모두 자연스러운 영어로 작성하세요.
- 한국어(한글) 출력 금지.
- 말투/독자 수준 지침이 한국어로 적혀 있어도, 영어로 동일한 톤/난이도로 자연스럽게 적용하세요. (직역 금지, 의역 OK)`
      : `

[언어 규칙 - 매우 중요]
- 출력 텍스트(chapter_title/scene/acting/dialogues/camera/mood)는 모두 자연스러운 한국어로 작성하세요.
- 불필요한 영어/로마자 남발 금지. (필요한 고유명사/약어는 허용)`;

  const naturalKoreanDialogueInstruction =
    params.language === "ko"
      ? `

[자연스러운 한국어 대사 방향 - 최우선]
- dialogues는 진짜 사람이 아주 자연스러운 말투로 설명하듯 작성하세요.
- 한국어 만화, 학습만화, 웹툰 말풍선에 바로 들어갈 수 있는 구어체여야 합니다.
- 좋은 대사는 "정보를 설명하는 문장"보다 "인물이 지금 상황에서 실제로 할 법한 말"입니다.
- 말풍선은 글자 수가 아니라 자연스러운 한 호흡 기준으로 쓰세요.
- 한 말풍선에는 기본적으로 1문장만 넣고, 2문장은 둘 다 아주 짧을 때만 허용하세요.
- 말풍선은 짧아야 해서가 아니라, 읽었을 때 한 사람이 자연스럽게 말한 덩어리처럼 느껴져야 해서 나눕니다.
- 같은 화자의 한 설명 흐름을 여러 말풍선으로 딱딱 끊지 마세요. 재료명, 도구명, 주의사항을 각각 별도 말풍선으로 나열하지 마세요.
- 자연스러운 한 호흡이 한국어 약 32~38자 이상으로 길어지면 한 말풍선에 우겨넣지 말고 다음 컷/리액션/나레이션으로 넘기세요. 숫자를 맞추려고 문장 중간을 자르지 마세요.
- 정보 밀도가 높아지면 문장 단위로 잘게 썰거나 두 개의 별도 문장으로 바꾸지 말고, 독자가 하나의 설명 흐름으로 이어 읽도록 컷 진행/리액션 컷/[narration] 박스로 넘기세요.
- 끊는 지점은 의미가 자연스럽게 쉬는 곳이어야 합니다. 조사/수식어/목적어 중간에서 자르지 마세요.
- 같은 페이지의 말풍선들이 모두 같은 설명형 종결어미로 끝나지 않게 하세요. 특히 "~요/~예요/~이에요" 계열을 연속 반복해 정의문 목록처럼 만들지 마세요.
- 한 페이지의 설명자/가이드 대사가 모두 같은 어미 계열로 끝나면 실패입니다. "~예요/~이에요", "~해요/~돼요", "~볼게요/~갈게요", "~주세요" 같은 존댓말 설명 종결을 같은 페이지에서 반복하지 마세요.
- 설명자/가이드 대사에는 최소 3가지 이상의 종결 리듬을 섞으세요: 질문형, 관찰형, 이유/원리형, 짧은 반응형, 명사형 정리, 행동 유도형 중 장면에 맞게 분산합니다.
- 행동 유도형("~해볼게요", "~맞춰주세요", "~가요")은 한 페이지에 많이 쓰면 튜토리얼처럼 보입니다. 꼭 필요한 컷에만 1번 정도 사용하세요.
- 문장 기능을 섞으세요: 관찰, 질문, 짧은 반응, 원인/결과 연결, 다음 행동 제안, 확인/정리 중 장면에 맞는 기능을 배치하세요.
- 정중한 톤을 유지하더라도 모든 말풍선을 완결된 설명문으로 닫지 말고, 장면 속 대화 리듬이 느껴지게 종결 방식을 바꾸세요.
- 장면의 감정, 관계, 반응이 말투에 묻어나게 쓰세요. 놀람은 짧게, 확신은 단단하게, 설명은 대화 속에서 가볍게.
- 입말 리듬을 살리되, 샘플 문장을 흉내 내지 말고 해당 장면의 상황/관계/행동에서 자연스럽게 나온 말만 쓰세요.
- 학습 정보가 필요할 때도 교과서 문장보다 캐릭터가 이해하고 반응하는 말로 풀어주세요.
- 말풍선은 항상 누군가에게 말을 거는 "발화"여야 합니다. 표제어, 목록, 발표 슬라이드, 요약 카드, 레시피 체크리스트처럼 쓰지 마세요.
- 제작 지시/규칙/자기검사 문장을 대사로 쓰지 마세요. "아직 원리를 다 말하지 말고", "먼저 이 장면을 잘 보면", "이 페이지에서는", "학습 행동", "밀도 점검" 같은 메타 표현은 금지입니다.
- 명사구/단어 조각만 단독으로 쓰지 마세요. 모든 대사는 앞뒤 맥락이 없어도 사람이 실제로 말한 한마디처럼 읽혀야 합니다.
- 같은 정보라도 장면 안에서 실제로 오갈 법한 말로 바꾸세요. 독자에게 뜬금없이 선택을 묻거나, 설명 카드처럼 정보를 나열하지 마세요.
- 설명해야 할 때도 그 컷의 행동, 표정, 관계, 긴장에 자연스럽게 붙여서 말하게 하세요.
- plan_meta/rationale/scene/camera는 설명적으로 써도 되지만, dialogues만큼은 말풍선용 구어체를 유지하세요.`
      : "";

  const learningComicNaturalSpeechInstruction = isLearningComic && !isAnyCinematic
    ? params.language === "ko"
      ? `

[한국어 학습만화 설명 대사 자연화 - 최우선]
- 학습 설명은 번역문, 설명서, 교과서 요약, 발표 대본처럼 쓰지 말고 실제 사람이 아이에게 쉽게 말해주는 입말로 쓰세요.
- "오늘은 ~ 배워요", "관찰 대상", "장치예요", "잘 진행돼요", "단계로 넘어가", "물만 스쳐서는"처럼 일상 대화에서 잘 쓰지 않는 표현을 피하세요.
- 독자가 이미 아는 생활어는 과하게 풀지 마세요. 예를 들어 "빠르게 돌려 물기를 줄이는 단계"처럼 설명서식으로 늘이지 말고, 맥락상 자연스러우면 "탈수"처럼 짧은 생활어를 씁니다.
- "먼저/그러면/이때/그다음/마지막으로" 같은 접속사를 문장마다 앞에 붙여 순서표처럼 만들지 마세요. 필요할 때만 쓰고, 문장 연결은 "~하거든", "~하는 거지", "~라고 보면 돼", "~잖아"처럼 한국어 어미 리듬으로 자연스럽게 이어가세요.
- "~해", "~만들어", "~빼", "~줄여"처럼 독자가 행동 지시로 읽을 수 있는 종결을 연속해서 쓰지 마세요. 현상 관찰, 상태 변화, 이유 설명, 정리 문장으로 종결을 섞으세요.
- "~이에요", "~해요", "~돼요", "~볼게요", "~주세요"처럼 같은 높임말 설명 종결이 이어지면 기계적인 선생님 말투가 됩니다. 설명자/가이드 말만 이어 붙였을 때 같은 어미 계열이 3번 이상 반복되면 다시 쓰세요.
- 반말 캐릭터면 반말 안에서도 "~야", "~거든", "~지", "~잖아", "~거야", 짧은 감탄/명사형 정리를 섞고, 존댓말 캐릭터면 존댓말 안에서도 질문/관찰/정리/리액션의 끝맺음을 섞으세요. 한 가지 말끝으로 통일하지 마세요.
- 설명은 조작 순서가 아니라 장면 안에서 벌어지는 현상으로 말하세요. "A하고 B하고 C한다"보다 "A가 이렇게 되니까 B가 일어난다"는 흐름이 좋습니다.
- 대사를 확정하기 전에 설명자/가이드 말만 이어 붙여 읽어보세요. 그 결과가 말풍선으로 쪼갠 설명문 목록처럼 들리면, 생활감 있는 질문/관찰에서 시작하는 한 편의 설명 대화로 다시 쓰세요.`
      : `

[Natural learning-comic explanation dialogue - highest priority]
- Do not write learning dialogue like a translated textbook, instruction manual, slide script, or list of steps. It should sound like a real person explaining something clearly in a scene.
- Open from a familiar everyday question, observation, or small problem instead of "Today we will learn about...".
- Do not over-explain familiar everyday actions. Use the natural term when readers already know it.
- Avoid starting every sentence with mechanical connectors such as "first", "then", "next", and "finally". Let cause, observation, and character reaction carry the flow.
- Avoid a run of imperative-like endings or procedural commands. Explain what is happening, why it changes, and what that means.
- Before finalizing, read only the guide/narrator dialogue in sequence. If it sounds like a manual split into bubbles, rewrite it as one natural explanation scene.`
    : "";

  const dialogueOnlyRule = isKlingI2V
    ? `- dialogues는 화면 텍스트가 아니라 "음성 대사"입니다. 프레임당 0~2줄의 짧은 구어체로 작성하세요.`
    : isPureCinematic
      ? `- 오직 장면 안에 실제로 표시될 짧은 대사 텍스트만 작성하세요. 해설문/강의문/교훈문은 금지합니다.`
      : `- 오직 말풍선에 들어갈 실제 대사만 작성하세요. 설명은 캐릭터가 실제로 말할 법한 짧은 구어체로 녹여 쓰세요.`;

  const aiToneRule = isKlingI2V
    ? `- 음성 합성 친화 규칙: 화자 포함 형식("화자: 대사")을 권장하고, 자막/말풍선/화면 텍스트 지시는 금지합니다.`
    : isPureCinematic
      ? `- 번역투/설명투 문장 금지: 대사는 인물의 목표/감정/관계를 드러내는 짧은 구어체로 작성하세요.`
      : `- 자연스러운 긍정문으로 바로 말하세요. 짧은 표어처럼 끊지 말고, 실제 설명하는 사람이 말하듯 앞뒤가 이어지는 한국어 입말을 우선하세요.`;

  const dialogueFormatExample = isKlingI2V
    ? `- 예: "주인공: 준비됐어?" (O), "친구: 지금 가자!" (O)`
    : params.language === "ko"
      ? `- 대사에는 화자 표시, 설명 제목, 요약 문장, 표제어, 단독 명사구를 넣지 마세요.`
      : `- 예: "주인공: 안녕하세요" (X) -> "안녕하세요" (O)`;

  const comicModeDisplay = isPureCinematic ? "Cinematic" : isEduCinematic ? "Edu-Cinematic" : "Learning";

  const systemInstruction = `${systemIntro}

[만화 모드]
- 모드: ${comicModeDisplay} (${params.comic_mode})

[톤 모드 - 매우 중요]
- 모드: ${toneMode === "gag" ? "개그" : "일반"}${toneModeInstruction}${toneMode === "gag" ? `\n- tone_level: ${toneLevel}` : ""}

[질문 형태]
- 타입: ${params.question_type}${effectiveQuestionTypeInstruction}

${planMetaInstruction}

[주인공 설정 및 역할]
- 주인공 외모: ${params.character_description}
- 주인공 역할: ${params.character_role === "narrator" ? "가이드/관찰자" : "직접 연기하는 배우"}
- 지침: ${effectiveRoleInstruction}

[텍스트 규정 - 매우 중요]
- ${isKlingI2V ? "I2V 모드에서는 dialogues에 화자 이름 포함 형식을 권장합니다. (음성 대사용)" : "대사(dialogues)에는 '주인공:', '나레이션:', '이름:' 등의 화자 표시를 절대 포함하지 마세요."}
${dialogueOnlyRule}
${dialogueFormatExample}
${aiToneRule}
${naturalKoreanDialogueInstruction}
${learningComicNaturalSpeechInstruction}

${frameworkInstruction}
${learningLayoutProInstruction}
${learningComicDialogueArcInstruction}
${learningComicScriptDistributionInstruction}

[형식 규정]
${isDynamicLayout
    ? `- 웹툰 페이지는 기본적으로 동적 레이아웃을 사용하되, 전체에서 최대 2페이지만 정적 앵커 템플릿을 허용하세요.
- 동적 페이지: 2~5개의 패널을 생성하고 webtoon_layout(panel_count, panel_heights, core_pattern, modifiers, gap_profile, focus_panel_index)를 포함하세요.
- 정적 앵커 페이지: template_id를 사용하고, panels 배열 길이를 해당 템플릿 컷 수에 맞추세요.
- modifiers는 보통 0~1개, 중요한 페이지도 최대 2개까지만 사용하세요.
- 특별한 이유가 없다면 template_id 없이 webtoon_layout만 사용하세요.
- 대화/리액션/클로즈업은 좁은 portrait-leaning 컷을 자주 사용하고, 전폭 가로 패널의 연속 반복을 피하세요.${webtoonAnchorGuidance}`
    : isLearningComicPro
      ? `- 프로 학습만화 페이지는 template_id를 반드시 사용하고, panels 배열 길이를 해당 템플릿 컷 수(3~7컷)에 정확히 맞추세요.`
    : `- 페이지당 정확히 ${panelsPerPage}개의 패널을 생성하세요.`}
- 언어: ${params.language}.
${languageInstruction}
${isDynamicLayout ? `- 레이아웃: 다이나믹 (핵심 패턴 + modifier 조합으로 페이지 리듬을 설계)` : `- 가용 템플릿: ${JSON.stringify(templateSummaries)}`}${isLearningComicPro ? "\n- 프로 레이아웃에서는 template_id와 learning_layout_intent를 페이지마다 반드시 함께 작성하세요." : ""}${castInstruction}${supportingCastInstruction}${characterConsistencyInstruction}${effectiveResearchInstruction}${effectiveDetailInstruction}${effectiveAudienceInstruction}${deliveryInstruction}`;

  const deliveryReminder = params.delivery_style
    ? `\n말투/제스처 프리셋: ${params.delivery_style.preset_label}\n말투/제스처 지침: ${params.delivery_style.instruction}\n(제스처/연기 지시는 dialogues가 아니라 acting 필드에만 작성)\n`
    : "";
  const outputModeReminder = isKlingI2V
    ? `\n출력 모드: Kling I2V storyboard\n비율: ${i2vAspectRatio}\n한 페이지는 1프레임(1컷)이며, dialogues는 음성 대사 기준으로 작성하세요.\n`
    : "";
  const dialoguePromptRule = isKlingI2V
    ? `대사는 화자 포함 형식("화자: 대사")으로 작성하고, 짧은 음성 대사(0~2줄)만 남기세요.`
    : `대사에서 화자 이름(주인공, 나레이션 등)을 모두 제거하고 순수 대사만 남기세요.`;

  const promptLearning = `주제: "${params.topic}"
질문 형태: ${params.question_type === "compare" ? "비교(Compare)" : params.question_type === "review" ? "리뷰(Review)" : "설명(Explain)"}
톤 모드: ${toneMode === "gag" ? `개그모드(${toneLevel})` : "일반모드"}
독자 수준: ${params.audience_level}
분량: ${params.page_count} 페이지.
디테일: ${params.detail_level}.
언어: ${params.language}.
${deliveryReminder}
${outputModeReminder}

${usingProvidedResearch ? "아래 리서치 팩을 바탕으로" : params.audience_level === "kids" ? "이 주제를 초등 저학년이 이해할 만큼 아주 쉽게 검색하고," : "이 주제의 '진짜 본질'을 검색하고,"} 주인공의 역할(${params.character_role === "narrator" ? "설명하는 가이드" : "직접 연기하는 배우"})에 맞춰 시나리오를 작성하세요.
${dialoguePromptRule}`;

  const promptEduCinematic = `주제: "${params.topic}"
모드: Edu-Cinematic (Show)
질문 형태: ${params.question_type === "compare" ? "대결(Compare)" : params.question_type === "review" ? "상황극(Review)" : "상황극(Explain)"}
톤 모드: ${toneMode === "gag" ? `개그모드(${toneLevel})` : "일반모드"}
독자 수준: ${params.audience_level}
분량: ${params.page_count} 페이지.
디테일: ${params.detail_level}.
언어: ${params.language}.
${deliveryReminder}
${outputModeReminder}

${usingProvidedResearch ? "아래 리서치 팩을 참고하되, " : ""}절대 설명하지 말고 영화/드라마처럼 장면으로만 전개하세요. (행동·대사·카메라·무드)
${dialoguePromptRule}`;

  const promptPureCinematic = `주제: "${params.topic}"
모드: Cinematic (Pure Story)
질문 형태: ${params.question_type === "compare" ? "라이벌전(Compare)" : params.question_type === "review" ? "체험극(Review)" : "스토리(Explain)"}
톤 모드: ${toneMode === "gag" ? `개그모드(${toneLevel})` : "일반모드"}
관람 톤: ${params.audience_level}
분량: ${params.page_count} 페이지.
디테일: ${params.detail_level}.
언어: ${params.language}.
${deliveryReminder}
${outputModeReminder}

${usingProvidedResearch ? "아래 리서치 팩을 월드빌딩 참고 재료로만 활용하고, " : ""}강의/해설 톤을 완전히 배제한 순수 시네마틱 스토리로 작성하세요.
영화/애니메이션/만화/실사 연출 감각을 적극 활용하되, 모든 컷은 하나의 일관된 작품 세계로 연결하세요.
${dialoguePromptRule}`;

  const prompt = isPureCinematic
    ? promptPureCinematic
    : isEduCinematic
      ? promptEduCinematic
      : promptLearning;

  const researchContext = usingProvidedResearch && researchNotes
    ? `\n\n[RESEARCH PACK]\n${researchNotes}\n`
    : "";

  const maxPagesPerRequest = isPaperStoryResearchPack ? 1 : getGeminiMaxPagesPerRequest();
  const targetPageCount = Math.max(1, Math.floor(params.page_count));

  const panelSchema = {
    type: Type.OBJECT,
    properties: {
      scene: { type: Type.STRING, description: "주인공의 역할에 기반한 구체적인 장면 묘사" },
      acting: { type: Type.STRING, description: "주인공의 제스처/표정/몸짓(말투 프리셋에 맞춘 연기 지시). dialogues에는 넣지 말고 여기에만 작성." },
      dialogues: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: isKlingI2V
          ? "음성 대사(0~2줄). 화자 포함 형식(예: 주인공: ... ) 권장. 자막/화면텍스트 지시 금지"
          : "대사 내용만 포함. 독백/내면 생각은 [thought] 접두사, 나레이션/해설은 [narration] 접두사를 붙이세요. 일반 대사(말)는 접두사 없이 작성. 예: [\"오늘 날씨 좋다!\", \"[thought]이게 정말 맞는 걸까...\", \"[narration]그날, 모든 것이 바뀌었다.\"]"
      },
      camera: { type: Type.STRING },
      mood: { type: Type.STRING },
      target_aspect_ratio: { type: Type.STRING }
    },
    required: ["scene", "acting", "dialogues", "target_aspect_ratio"]
  };

  const webtoonLayoutSchema = {
    type: Type.OBJECT,
    properties: {
      panel_count: { type: Type.NUMBER, description: "이 스트립의 패널 수 (2~5)" },
      core_pattern: { type: Type.STRING, description: `핵심 패턴 1개 선택: ${WEBTOON_CORE_PATTERN_DOC}` },
      modifiers: {
        type: Type.ARRAY,
        items: { type: Type.STRING, description: `선택 modifier: ${WEBTOON_MODIFIER_DOC}` },
        minItems: "0",
        maxItems: "2"
      },
      gap_profile: { type: Type.STRING, description: `컷 간 여백 리듬: ${WEBTOON_GAP_PROFILE_DOC}` },
      focus_panel_index: { type: Type.NUMBER, description: "시각적으로 가장 강조할 패널 번호 (1-based)" },
      panel_heights: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            scene_type: { type: Type.STRING, description: "dialogue|action|emotional|establishing|transition|impact|closeup" },
            height_weight: { type: Type.NUMBER, description: "패널 높이 가중치 (1=짧음, 5=매우 큼)" },
          },
          required: ["scene_type", "height_weight"]
        }
      }
    },
    required: ["panel_count", "core_pattern", "modifiers", "gap_profile", "focus_panel_index", "panel_heights"]
  };

  const webtoonScrollChoreographySchema = {
    type: Type.OBJECT,
    properties: {
      segment_index: { type: Type.NUMBER, description: "현재 웹툰 세그먼트 번호. 페이지 번호와 같게 둡니다." },
      canvas_size: { type: Type.STRING, description: "항상 1024x3072" },
      segment_role: { type: Type.STRING, description: "intro|beat|pause|climax|outro 중 하나" },
      choreography_pattern: { type: Type.STRING, description: `세로 웹툰 연출 패턴: ${WEBTOON_SCROLL_PATTERN_DOC}` },
      beats: {
        type: Type.ARRAY,
        description: "4개 이상의 beats라면 pause_space|bubble_space|borderless_scene|reaction_micro|transition_air 중 최소 2개 이상 포함. panel 3연속 금지. 비패널 구간 height_weight 합은 전체의 약 35% 이상 권장.",
        minItems: "2",
        maxItems: "6",
        items: {
          type: Type.OBJECT,
          properties: {
            kind: { type: Type.STRING, description: `연출 구간 종류: ${WEBTOON_SCROLL_BEAT_KIND_DOC}` },
            height_weight: { type: Type.NUMBER, description: "세로 길이 가중치 (1=짧음, 6=매우 김)" },
            visual_intent: { type: Type.STRING, description: "이 구간의 시각적 목적. 예: 긴 흰 여백으로 침묵 만들기" },
            text_intent: { type: Type.STRING, description: "말풍선/나레이션/텍스트 의도. 없으면 빈 문자열" },
            framing: { type: Type.STRING, description: `권장 프레이밍: ${WEBTOON_SCROLL_FRAMING_DOC}` },
            width_profile: { type: Type.STRING, description: `가로 폭 리듬: ${WEBTOON_SCROLL_WIDTH_PROFILE_DOC}. full만 반복하지 말고 medium/narrow/tiny를 섞으세요.` },
            x_position: { type: Type.STRING, description: `가로 위치: ${WEBTOON_SCROLL_X_POSITION_DOC}. center만 반복하지 말고 left/right/drift를 섞으세요.` },
            shape_style: { type: Type.STRING, description: `컷 형태: ${WEBTOON_SCROLL_SHAPE_STYLE_DOC}. borderless/diagonal/inset/overlap 중 하나 이상 권장.` },
            vertical_role: { type: Type.STRING, description: `스크롤 역할: ${WEBTOON_SCROLL_VERTICAL_ROLE_DOC}. pause/drop/reveal 중 하나 이상 포함.` },
            scroll_distance: { type: Type.STRING, description: `세로 호흡: ${WEBTOON_SCROLL_DISTANCE_DOC}. long/very_long 중 하나 이상 포함.` },
          },
          required: ["kind", "height_weight", "visual_intent"]
        }
      }
    },
    required: ["segment_index", "canvas_size", "segment_role", "choreography_pattern", "beats"]
  };

  const learningLayoutIntentSchema = {
    type: Type.OBJECT,
    properties: {
      role: { type: Type.STRING, description: `학습 레이아웃 역할: ${LEARNING_LAYOUT_ROLE_DOC}` },
      focus_panel_index: { type: Type.NUMBER, description: isLearningComicPro ? "가장 강조할 컷 번호 (선택한 템플릿 컷 수 안에서 1~7)" : "가장 강조할 컷 번호 (1~4)" },
      visual_flow: { type: Type.STRING, description: `페이지 안의 읽기 흐름: ${LEARNING_LAYOUT_FLOW_DOC}` },
      density: { type: Type.STRING, description: `정보 밀도: ${LEARNING_LAYOUT_DENSITY_DOC}` },
      template_reason: { type: Type.STRING, description: "선택한 template_id가 이 학습 흐름에 맞는 이유 1문장" },
    },
    required: ["role", "focus_panel_index", "visual_flow", "density", "template_reason"]
  };

  const pageSchema = {
    type: Type.OBJECT,
    properties: {
      chapter_title: { type: Type.STRING },
      template_id: {
        type: Type.STRING,
        ...(isDynamicLayout
          ? { description: `정적 웹툰 앵커 페이지일 때만 사용: ${webtoonAnchorTemplateSummaries.map((t) => t.id).join("|")}` }
          : {})
      },
      ...(isDynamicLayout ? { webtoon_layout: webtoonLayoutSchema } : {}),
      ...(isWebtoon ? { scroll_choreography: webtoonScrollChoreographySchema } : {}),
      ...(isLearningComicPro ? { learning_layout_intent: learningLayoutIntentSchema } : {}),
      panels: {
        type: Type.ARRAY,
        minItems: String(minPanels),
        maxItems: String(maxPanels),
        items: panelSchema
      }
    },
    required: isLearningComicPro ? ["chapter_title", "template_id", "panels", "learning_layout_intent"] : ["chapter_title", "panels"]
  };

  const buildPagesSchema = (count: number) => ({
    type: Type.ARRAY,
    minItems: String(count),
    maxItems: String(count),
    items: pageSchema
  });

  const outlineResponseSchema = (pageCount: number) => ({
    type: Type.OBJECT,
    properties: {
      series_title: { type: Type.STRING, description: "만화 시리즈 제목" },
      core_insight: { type: Type.STRING, description: "주제의 핵심 한 줄 요약" },
      rationale: { type: Type.STRING, description: "페이지 배분/구성 이유 1~2문장" },
      page_outlines: {
        type: Type.ARRAY,
        minItems: String(pageCount),
        maxItems: String(pageCount),
        items: {
          type: Type.OBJECT,
          properties: {
            page_number: { type: Type.NUMBER },
            sub_topic: { type: Type.STRING, description: "이 페이지의 소주제/제목 (1줄)" },
            content_summary: { type: Type.STRING, description: "이 페이지에서 다룰 내용 요약 (1~2문장)" },
            narrative_function: { type: Type.STRING, description: "서사 기능: introduction | deepening | turning_point | climax | resolution | recap" },
            learning_action: { type: Type.STRING, description: "학습만화에서 이 페이지가 담당하는 학습 행동 1개. 예: situation_hook | need_discovery | naming | example_reading | comparison | misconception_fix | practice | recap" },
            reader_question: { type: Type.STRING, description: "이 페이지에서 독자가 자연스럽게 품을 질문 1개" },
            opening_scene: { type: Type.STRING, description: "첫 컷에 보이는 구체적인 장면. 정의문/목표 선언 금지" },
            page_reveal: { type: Type.STRING, description: "페이지 끝에서 독자가 새로 붙잡는 작은 깨달음 1개" },
            dialogue_goal: { type: Type.STRING, description: "이 페이지 말풍선의 역할. 예: 관찰하게 하기, 비교하게 하기, 이름 붙이기, 헷갈림 풀기" },
            page_speech_flow: { type: Type.STRING, description: "이 페이지의 설명자 말을 이어 읽었을 때 자연스럽게 들리는 짧은 흐름. 패널 대사 초안이 아니라 말의 호흡" },
            dont_explain_yet: { type: Type.STRING, description: "이 페이지에서는 아직 말하지 말아야 할 후반 정보. 없으면 빈 문자열" },
            allowed_content: { type: Type.ARRAY, items: { type: Type.STRING }, description: "이 페이지에서 실제로 설명해도 되는 정보만 2~4개" },
            forbidden_content: { type: Type.ARRAY, items: { type: Type.STRING }, description: "다음 페이지 이후로 넘겨야 해서 이 페이지에서는 말하면 안 되는 정보" },
            next_page_tease: { type: Type.STRING, description: "페이지 끝에서 다음 페이지로 넘기는 작은 궁금증. 없으면 빈 문자열" },
            density_note: { type: Type.STRING, description: "정보 밀도 점검. 한 페이지에 몰아넣지 않고 무엇을 다음 페이지/그림/생략으로 보냈는지 1문장" },
            connection_to_previous: { type: Type.STRING, description: "이전 페이지와의 연결 (1페이지는 빈 문자열)" }
          },
          required: isLearningComic && !isAnyCinematic
            ? ["page_number", "sub_topic", "content_summary", "narrative_function", "learning_action", "reader_question", "opening_scene", "page_reveal", "dialogue_goal", "page_speech_flow", "dont_explain_yet", "allowed_content", "forbidden_content", "next_page_tease", "density_note", "connection_to_previous"]
            : ["page_number", "sub_topic", "content_summary", "narrative_function", "connection_to_previous"]
        }
      }
    },
    required: ["series_title", "core_insight", "rationale", "page_outlines"]
  });

  const fullResponseSchema = (count: number) => ({
    type: Type.OBJECT,
    properties: {
      series_title: { type: Type.STRING },
      plan_meta: {
        type: Type.OBJECT,
        properties: {
          core_insight: { type: Type.STRING },
          rationale: { type: Type.STRING },
          beats: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING } } } }
        }
      },
      pages: buildPagesSchema(count)
    },
    required: ["pages", "series_title", "plan_meta"]
  });

  const pagesOnlyResponseSchema = (count: number) => ({
    type: Type.OBJECT,
    properties: {
      pages: buildPagesSchema(count)
    },
    required: ["pages"]
  });

  const toGroundingSources = (resp: { candidates?: any[] }): GroundingSource[] => {
    const groundingChunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    return groundingChunks
      .filter((chunk: any) => chunk.web)
      .map((chunk: any) => ({
        title: chunk.web!.title || "참고 자료",
        uri: chunk.web!.uri
      }));
  };

  const mergeGroundingSources = (base: GroundingSource[], next: GroundingSource[]): GroundingSource[] => {
    const dedup = new Map<string, GroundingSource>();
    for (const item of base) dedup.set(item.uri, item);
    for (const item of next) dedup.set(item.uri, item);
    return Array.from(dedup.values());
  };

  const pageRangeHint = (startIndex: number, count: number, priorTitles: string[], outline?: PlanOutline | null) => {
    const endIndex = startIndex + count - 1;
    const prior =
      priorTitles.length > 0
        ? `\n\n[이미 작성된 페이지 제목(중복 금지)]\n- ${priorTitles.join("\n- ")}\n`
        : "";
    let rangeOutlineReminder = "";
    if (outline) {
      const relevantEntries = outline.page_outlines.filter(
        e => e.page_number >= startIndex && e.page_number <= endIndex
      );
      if (relevantEntries.length > 0) {
        rangeOutlineReminder = `\n\n[이번 범위에서 작성할 페이지 아웃라인 요약 - 내부 제작 메모]\n`;
        rangeOutlineReminder += `- 아래 학습 행동/질문/장면/밀도 점검 문구는 대사로 말하지 마세요. scene/acting/dialogues/camera에 자연스럽게 반영만 하세요.\n`;
        rangeOutlineReminder += `- allowed_content 범위 안에서만 설명하세요. forbidden_content/아직 말하지 않기에 있는 정보가 dialogues, narration, screen text, scene 설명의 정보 내용으로 나오면 실패입니다.\n`;
        for (const e of relevantEntries) {
          rangeOutlineReminder += `- p${e.page_number}: ${e.sub_topic} → ${e.content_summary}`;
          if (e.learning_action) rangeOutlineReminder += ` / 학습 행동: ${e.learning_action}`;
          if (e.reader_question) rangeOutlineReminder += ` / 독자 질문: ${e.reader_question}`;
          if (e.opening_scene) rangeOutlineReminder += ` / 첫 장면: ${e.opening_scene}`;
          if (e.page_reveal) rangeOutlineReminder += ` / 작은 깨달음: ${e.page_reveal}`;
          if (e.dialogue_goal) rangeOutlineReminder += ` / 대사 역할: ${e.dialogue_goal}`;
          if (e.page_speech_flow) rangeOutlineReminder += ` / 말 흐름: ${e.page_speech_flow}`;
          if (e.dont_explain_yet) rangeOutlineReminder += ` / 아직 말하지 않기: ${e.dont_explain_yet}`;
          if (Array.isArray(e.allowed_content) && e.allowed_content.length > 0) rangeOutlineReminder += ` / 허용 정보: ${e.allowed_content.join(" | ")}`;
          if (Array.isArray(e.forbidden_content) && e.forbidden_content.length > 0) rangeOutlineReminder += ` / 금지 정보: ${e.forbidden_content.join(" | ")}`;
          if (e.next_page_tease) rangeOutlineReminder += ` / 다음 힌트: ${e.next_page_tease}`;
          if (e.density_note) rangeOutlineReminder += ` / 밀도 점검: ${e.density_note}`;
          rangeOutlineReminder += "\n";
        }
      }
    }
    return `\n\n[페이지 범위 - 매우 중요]
- 전체 분량은 총 ${targetPageCount}페이지입니다.
- 이번 응답에서는 ${startIndex}~${endIndex}페이지에 해당하는 내용만 작성하세요. (총 ${count}페이지)
- pages 배열 길이는 반드시 ${count}여야 합니다.
- 각 페이지는 panels가 ${isWebtoon ? "정적 앵커면 템플릿 컷 수, 동적이면 2~5개(webtoon_layout.panel_count와 일치)" : isDynamicLayout ? "2~5개 (webtoon_layout.panel_count와 일치)" : isLearningComicPro ? "선택한 template_id의 컷 수와 일치(3~7개)" : `반드시 ${panelsPerPage}개`}여야 합니다.${prior}${rangeOutlineReminder}`;
  };

  const buildPaperPageOnlyContext = (startIndex: number, count: number, outline?: PlanOutline | null): string => {
    if (!isPaperStoryResearchPack || !outline) return "";
    const endIndex = startIndex + count - 1;
    const relevantEntries = outline.page_outlines.filter(
      e => e.page_number >= startIndex && e.page_number <= endIndex
    );
    if (relevantEntries.length === 0) return "";

    const lines: string[] = [
      "",
      "[이번 페이지에서만 볼 재료 - 논문만화]",
      "전체 리서치 팩을 다시 펼치지 마세요. 지금은 아래 페이지에 필요한 재료만 보고 만화를 씁니다.",
      "뒤 페이지에 배정된 연구 질문, 방법, 결과, 기여, 한계는 지금 페이지에 미리 넣지 않습니다.",
      "논문에 없는 가짜 예시를 새로 만들지 마세요. 고양이 이야기, 상자, 창고, 버튼, 게임, 동화 같은 임의의 비유로 시작하지 말고, 논문이 실제로 다루는 분야의 자료와 화면을 보여주세요.",
      "비유가 필요하면 바로 무엇을 뜻하는지 알 수 있어야 합니다. 비유만 읽고 논문 배경을 알 수 없으면 실패입니다.",
      "page_speech_flow는 그대로 복붙할 대본이 아니라 말의 호흡입니다. 패널로 나눌 때 자연스럽게 다듬되, 허용된 정보 밖으로 나가지 마세요.",
      "같은 장면이나 같은 대사를 페이지 안에서 반복하지 마세요. 반복 대신 관찰, 반응, 작은 전환으로 이어가세요.",
      ""
    ];

    for (const e of relevantEntries) {
      lines.push(`[p${e.page_number}] ${e.sub_topic}`);
      lines.push(`이 페이지는 여기까지만: ${e.content_summary}`);
      if (e.page_number === 1) {
        lines.push("첫 페이지는 천천히 시작합니다. 배경의 공기와 눈앞의 상황만 보여줘도 충분합니다.");
        lines.push("첫 페이지에서 말하지 않을 것: 전문 데이터 부족, 비용, 보안, 개인정보, 법률 문제, 연구 질문, 방법, 결과, 기여, 한계.");
        lines.push("첫 페이지에서 피할 것: 논문에 없는 고양이 이야기, 상자, 창고, 버튼, 게임, 동화 같은 임의의 비유.");
      }
      if (e.opening_scene) lines.push(`첫 장면: ${e.opening_scene}`);
      if (e.reader_question) lines.push(`독자가 품을 궁금증: ${e.reader_question}`);
      if (e.page_speech_flow) lines.push(`말의 흐름: ${e.page_speech_flow}`);
      if (Array.isArray(e.allowed_content) && e.allowed_content.length > 0) {
        lines.push("말해도 되는 것:");
        for (const item of e.allowed_content) lines.push(`- ${item}`);
      }
      if (Array.isArray(e.forbidden_content) && e.forbidden_content.length > 0) {
        lines.push("아직 말하지 않을 것:");
        for (const item of e.forbidden_content) lines.push(`- ${item}`);
      }
      if (e.next_page_tease) lines.push(`마지막에 남길 작은 궁금증: ${e.next_page_tease}`);
      if (e.page_reveal) lines.push(`페이지 끝에서 붙잡을 것: ${e.page_reveal}`);
      lines.push("");
    }

    return `\n${lines.join("\n")}`;
  };

  const requestPlanner = async (contents: string, responseSchema: any, enableSearch: boolean, schemaName: string) => {
    return await requestGeminiStructured({
      systemInstruction,
      contents,
      responseSchema,
      schemaName,
      reasoningEffort: geminiReasoningEffort,
      enableSearch,
      maxOutputTokens: getGeminiPlannerMaxOutputTokens(getGeminiMaxOutputTokens())
    });
  };

  const requestOutline = async (contents: string, enableSearch: boolean) => {
    return await requestGeminiStructured({
      systemInstruction,
      contents,
      responseSchema: outlineResponseSchema(targetPageCount),
      schemaName: "planner_outline",
      reasoningEffort: geminiReasoningEffort,
      enableSearch,
      maxOutputTokens: 4096
    });
  };

  const buildOutlinePrompt = (): string => {
    const modeLabel = isPureCinematic ? "시네마틱 스토리"
      : isEduCinematic ? "에듀-시네마틱"
      : isKlingI2V ? "I2V 스토리보드"
      : "교육 만화";

    return `${prompt}

  [아웃라인 작성 지시 - 매우 중요]
  - 위 주제에 대해 총 ${targetPageCount}페이지의 ${modeLabel} 아웃라인을 작성하세요.
  - 각 페이지마다: 소주제(sub_topic), 내용 요약(content_summary 1~2문장), 서사적 기능(narrative_function), 이전 페이지와의 연결을 명시하세요.
  - 각 페이지는 고유한 소주제/정보를 담아야 합니다. 페이지 간 내용 중복은 금지입니다.
  - 전체 흐름이 자연스럽게 이어져야 합니다. (도입→전개→심화→마무리)
  ${isLearningComic && !isAnyCinematic ? `- 먼저 자료를 설명 순서가 아니라 독자가 이해하는 순서로 나누세요. 한 페이지는 독자의 생각이 한 번 움직이는 정도면 충분합니다.
  - 각 페이지마다 reader_question(독자가 품을 궁금증), opening_scene(첫 컷에 보이는 장면), page_reveal(끝에서 붙잡을 것), dialogue_goal(말풍선이 하는 일), page_speech_flow(말의 호흡), dont_explain_yet(아직 미룰 정보)을 구분하세요.
  - page_speech_flow는 제작자가 조용히 읽어봤을 때 사람 말처럼 이어지는 짧은 흐름이어야 합니다. 발표문, 지시문, 규칙 설명처럼 쓰지 마세요.
  - opening_scene은 설명 문장이 아니라 실제로 그릴 수 있는 장면이어야 합니다. "조리개란...", "오늘은..." 같은 말풍선 시작문을 opening_scene에 쓰지 마세요.
  - page_reveal은 대단한 결론이 아니라도 됩니다. 독자가 "그래서 이 다음을 보면 되겠구나" 하고 한 발짝 이동하는 정도면 충분합니다.
  - 리서치/핵심정리에 [PAPER STORY UNITS]가 있으면 [LEARNING UNITS]보다 우선하고, unit 순서를 기본 페이지 순서로 사용하세요.
  - 논문만화 1페이지는 첫 PAPER STORY UNIT만 사용하세요. 배경의 공기와 눈앞의 상황만 보여주고, 전문 데이터 부족/비용/보안/개인정보/연구 질문/방법/결과/기여/한계는 앞당기지 마세요.
  - 논문만화 첫 3개 unit(원래 세계/기대하던 흐름/작은 틈)은 6페이지 이상에서는 합치지 마세요. 줄여야 할 때는 뒤쪽의 검증+결과 의미, 한계+마무리처럼 독자 부담이 낮은 인접 단계부터 합치세요.
  - 각 페이지 outline에는 unit의 allowed_content, forbidden_content, next_page_tease를 복사하거나 좁혀 쓰세요. content_summary/page_reveal/dialogue_goal/page_speech_flow에 forbidden_content가 섞이면 실패입니다.
  - 리서치/핵심정리에 [LEARNING UNITS]가 번호로 정리되어 있으면, 그 순서를 아웃라인의 기본 페이지 순서로 사용하세요. targetPageCount가 unit 수 이상이면 unit 하나를 페이지 하나로 매핑하세요.
  - targetPageCount가 unit 수보다 적을 때만 인접한 저부담 unit 2개를 합칠 수 있습니다. 첫 페이지에는 상황/필요성/이름 붙이기 중 최대 2개까지만 허용하고, 핵심 기능/결과 비교/오해/요약까지 끌어오지 마세요.
  - 1페이지 content_summary는 용어 정의가 아니라 독자가 눈으로 볼 수 있는 상황, 대비, 궁금증, 문제에서 시작하세요. "○○란..."으로 바로 시작하는 opening/definition-first 아웃라인은 실패입니다.
  - [FRAMING]에 정의로 시작하라는 문장이 있어도, [LEARNING UNITS]와 충돌하면 [LEARNING UNITS]를 우선하고 FRAMING은 시각 톤 참고로만 쓰세요.
  - 한 페이지에 정의/뜻/사용 상황/예문/해석/주의점/요약이 3개 이상 함께 들어가면 과밀입니다. density_note에 무엇을 줄였는지 적고 content_summary를 다시 좁히세요.
  - 절차/방법/언어 문법 주제는 "상황 느끼기 → 필요성 발견 → 이름 붙이기 → 예문/단계 확인 → 비교/주의점 → 연습/정리"처럼 독자가 따라갈 학습 행동 흐름으로 배분하세요.
  - 페이지 수가 고정되어 있어도 한 페이지가 여러 역할을 떠안게 만들지 마세요. 덜 중요한 예외/요약/부가 설명은 과감히 생략하거나 그림으로 넘기세요.` : ""}
- 이것은 아웃라인입니다. 실제 대사(dialogues)나 scene/acting/camera를 작성하지 마세요.`;
  };

  const formatOutlineForPrompt = (ol: PlanOutline): string => {
    const lines: string[] = [
      `\n\n[전체 페이지 아웃라인 - 최우선 준수]`,
      `- 아래 아웃라인에 따라 각 페이지를 작성하세요.`,
      `- 각 페이지는 해당 page_number의 소주제와 내용 요약만 다루세요.`,
      `- 학습 행동/독자 질문/첫 장면/작은 깨달음/대사 역할/말 흐름/허용 정보/금지 정보/다음 힌트/밀도 점검은 내부 제작 메모입니다. 해당 표현을 캐릭터 대사나 나레이션으로 직접 말하지 마세요.`,
      `- 허용 정보 안에서만 설명하고, 금지 정보는 대사/나레이션/화면 텍스트/장면 설명에 앞당겨 넣지 마세요.`,
      `- 다른 페이지에 배정된 내용을 중복해서 다루지 마세요.\n`
    ];
    for (const entry of ol.page_outlines) {
      lines.push(`[p${entry.page_number}] ${entry.sub_topic}`);
      lines.push(`  내용: ${entry.content_summary}`);
      lines.push(`  기능: ${entry.narrative_function}`);
      if (entry.learning_action) {
        lines.push(`  학습 행동: ${entry.learning_action}`);
      }
      if (entry.reader_question) {
        lines.push(`  독자 질문: ${entry.reader_question}`);
      }
      if (entry.opening_scene) {
        lines.push(`  첫 장면: ${entry.opening_scene}`);
      }
      if (entry.page_reveal) {
        lines.push(`  작은 깨달음: ${entry.page_reveal}`);
      }
      if (entry.dialogue_goal) {
        lines.push(`  대사 역할: ${entry.dialogue_goal}`);
      }
      if (entry.page_speech_flow) {
        lines.push(`  말 흐름: ${entry.page_speech_flow}`);
      }
      if (entry.dont_explain_yet) {
        lines.push(`  아직 말하지 않기: ${entry.dont_explain_yet}`);
      }
      if (Array.isArray(entry.allowed_content) && entry.allowed_content.length > 0) {
        lines.push(`  허용 정보: ${entry.allowed_content.join(" / ")}`);
      }
      if (Array.isArray(entry.forbidden_content) && entry.forbidden_content.length > 0) {
        lines.push(`  금지 정보: ${entry.forbidden_content.join(" / ")}`);
      }
      if (entry.next_page_tease) {
        lines.push(`  다음 힌트: ${entry.next_page_tease}`);
      }
      if (entry.density_note) {
        lines.push(`  밀도 점검: ${entry.density_note}`);
      }
      if (entry.connection_to_previous) {
        lines.push(`  연결: ${entry.connection_to_previous}`);
      }
    }
    return lines.join("\n");
  };

  const paperFirstPageLatePattern = /전문|개인정보|비용|보안|법률|의료|현장|부족|접근|연구\s*질문|방법|결과|기여|한계|해결|문제/;
  const paperFirstPageInventedMetaphorPattern = /고양이|상자|서랍|창고|버튼|게임|동화|전설|외계|마법|왕국|퀘스트|카드|몬스터|이야기\s*\d+/;
  const unsafePaperFirstPagePattern = (text: string) =>
    paperFirstPageLatePattern.test(text) || paperFirstPageInventedMetaphorPattern.test(text);
  const sanitizePaperFirstOutlineEntry = (entry: PageOutlineEntry): PageOutlineEntry => {
    if (!isPaperStoryResearchPack || entry.page_number !== 1) return entry;

    const firstForbidden = [
      "전문 데이터가 부족하다는 문제",
      "접근 비용, 보안, 개인정보, 법률 문제",
      "이 논문의 연구 질문, 방법, 결과, 기여, 한계",
      "논문에 없는 고양이 이야기, 상자, 서랍, 창고, 버튼, 게임, 동화 같은 임의의 비유",
      "비유만 있고 실제 연구 배경이 무엇인지 알 수 없는 장면",
      "왜 이 문제가 중요한지 직접 선언하는 말",
      "문제의 답이나 해결 방향"
    ];
    const safeAllowed = Array.isArray(entry.allowed_content)
      ? entry.allowed_content.filter((item) => !unsafePaperFirstPagePattern(item))
      : [];

    return {
      ...entry,
      sub_topic: unsafePaperFirstPagePattern(entry.sub_topic)
        ? "논문이 다루는 실제 배경"
        : entry.sub_topic,
      content_summary: unsafePaperFirstPagePattern(entry.content_summary)
        ? "논문이 실제로 다루는 분야에서 어떤 자료와 도구가 쓰이는지 차분히 보여준다. 임의의 비유를 만들지 않고, 아직 문제나 해결책은 말하지 않는다."
        : entry.content_summary,
      opening_scene: unsafePaperFirstPagePattern(entry.opening_scene || "")
        ? "논문이 다루는 실제 분야의 공개 자료, 화면, 도구, 기록이 차분히 보이는 장면"
        : entry.opening_scene,
      page_reveal: unsafePaperFirstPagePattern(entry.page_reveal || "")
        ? "이 연구는 실제 자료가 쌓이고 쓰이는 배경에서 출발한다는 정도만 붙잡는다."
        : entry.page_reveal,
      page_speech_flow: unsafePaperFirstPagePattern(entry.page_speech_flow || "")
        ? "먼저 이 연구가 놓인 배경부터 보자. 여기에는 실제로 쓰이는 자료와 기록, 도구들이 있어. 아직 답을 말하기보다는, 이런 세계에서 이야기가 시작된다는 것만 보면 돼."
        : entry.page_speech_flow,
      allowed_content: safeAllowed.length > 0
        ? safeAllowed
        : [
          "논문이 다루는 실제 분야의 배경",
          "그 분야에서 쓰이는 자료, 기록, 화면, 도구",
          "아직 문제가 드러나기 전의 평범한 흐름"
        ],
      forbidden_content: Array.from(new Set([...(entry.forbidden_content || []), ...firstForbidden])),
      next_page_tease: entry.next_page_tease && !paperFirstPageLatePattern.test(entry.next_page_tease)
        ? entry.next_page_tease
        : "그런데 모든 자료가 이렇게 쉽게 열려 있을까?",
      density_note: "1페이지는 배경만 남기고, 전문 영역의 틈과 논문 이야기는 다음 페이지 이후로 넘긴다."
    };
  };

  const templateUsageCount = new Map<string, number>();
  const chosenTemplateHistory: string[] = [];
  const shouldDiversifyTemplates =
    !isDynamicLayout &&
    !isKlingI2V &&
    params.layout_variety !== "low" &&
    params.templates.length > 1;
  const recentTemplateWindow = params.layout_variety === "high" ? 4 : 2;

  const templateTierScore = (template: LayoutTemplate): number => {
    if (params.layout_variety === "high") {
      if (template.variety_tier === "high") return 3;
      if (template.variety_tier === "medium") return 2;
      return 1;
    }
    if (params.layout_variety === "medium") {
      if (template.variety_tier === "medium") return 3;
      if (template.variety_tier === "high") return 2;
      return 1;
    }
    return 1;
  };

  const pickDiversifiedTemplate = (preferred: LayoutTemplate): LayoutTemplate => {
    if (!shouldDiversifyTemplates) return preferred;

    const recentIds = new Set(chosenTemplateHistory.slice(-recentTemplateWindow));
    if (!recentIds.has(preferred.id)) return preferred;

    let candidates = params.templates.filter((t) => !recentIds.has(t.id));
    if (candidates.length === 0) {
      candidates = params.templates.filter((t) => t.id !== preferred.id);
    }
    if (candidates.length === 0) return preferred;

    candidates.sort((a, b) => {
      const tierDiff = templateTierScore(b) - templateTierScore(a);
      if (tierDiff !== 0) return tierDiff;
      const usageDiff = (templateUsageCount.get(a.id) || 0) - (templateUsageCount.get(b.id) || 0);
      if (usageDiff !== 0) return usageDiff;
      return a.id.localeCompare(b.id);
    });
    return candidates[0] || preferred;
  };

  const markTemplateUsage = (template: LayoutTemplate): LayoutTemplate => {
    chosenTemplateHistory.push(template.id);
    templateUsageCount.set(template.id, (templateUsageCount.get(template.id) || 0) + 1);
    return template;
  };

  let usedWebtoonStaticAnchorPages = 0;
  const webtoonPatternHistory: string[] = [];
  const webtoonPatternSelectionDebug: any[] = [];

  const normalizeWebtoonHybridPage = (rawPage: any, pageNumber: number) => {
    if (!isWebtoon) return rawPage;

    const next = rawPage && typeof rawPage === "object" ? { ...rawPage } : {};
    const explicitTemplateId = typeof next.template_id === "string" ? next.template_id.trim() : "";
    const hasDynamicLayout = Boolean(next.webtoon_layout && typeof next.webtoon_layout === "object");
    const isStaticAnchor = explicitTemplateId && isWebtoonStaticAnchorTemplateId(explicitTemplateId);

    if (isStaticAnchor && usedWebtoonStaticAnchorPages < MAX_WEBTOON_STATIC_ANCHOR_PAGES) {
      usedWebtoonStaticAnchorPages += 1;
      delete next.webtoon_layout;
      return next;
    }

    if (hasDynamicLayout) {
      delete next.template_id;
      return next;
    }

    if (isStaticAnchor && usedWebtoonStaticAnchorPages >= MAX_WEBTOON_STATIC_ANCHOR_PAGES) {
      delete next.template_id;
    }

    delete next.template_id;
    return next;
  };

  const mapPages = (rawPages: any[], startIndex: number): PageSpec[] => {
    return rawPages.map((rawPage: any, idx: number) => {
      const pageNumber = startIndex + idx;
      const p = normalizeWebtoonHybridPage(rawPage, pageNumber);
      let template: LayoutTemplate;
      let actualPanelCount: number;
      let dynamicLayoutForPage: PageSpec["layout"]["webtoon_layout"] | undefined;
      let scrollChoreographyForPage: PageSpec["layout"]["scroll_choreography"] | undefined;
      let learningLayoutIntentForPage: PageSpec["layout"]["learning_layout_intent"] | undefined;
      const narrativeFunction = getOutlineNarrativeFunction(outline, pageNumber);
      const explicitTemplateId = typeof p?.template_id === "string" ? p.template_id.trim() : "";
      const explicitTemplate = explicitTemplateId
        ? params.templates.find((t) => t.id === explicitTemplateId)
        : undefined;
      const safePanels = Array.isArray(p?.panels) ? p.panels : [];
      const generatedPanelCount = safePanels.length;

      if (isWebtoon && explicitTemplate) {
        template = markTemplateUsage(explicitTemplate);
        actualPanelCount = explicitTemplate.panels.length;
        webtoonPatternHistory.push(`static:${explicitTemplate.id}`);
      } else if (isDynamicLayout && p.webtoon_layout) {
        try {
          const { layout, debugEntry } = finalizeWebtoonDynamicLayout({
            rawLayout: p.webtoon_layout,
            pageNumber,
            totalPages: targetPageCount,
            previousPatterns: webtoonPatternHistory,
            narrativeFunction,
          });
          template = buildDynamicWebtoonTemplate(layout);
          actualPanelCount = layout.panel_count;
          dynamicLayoutForPage = layout;
          webtoonPatternHistory.push(layout.core_pattern);
          webtoonPatternSelectionDebug.push(debugEntry);
        } catch {
          const fallback = params.templates[0];
          template = fallback;
          actualPanelCount = panelsPerPage;
          if (isWebtoon) webtoonPatternHistory.push(`static:${fallback.id}`);
        }
      } else {
        const forcedTemplate = params.templates[0];
        learningLayoutIntentForPage = isLearningComicPro
          ? normalizeLearningLayoutIntent(p?.learning_layout_intent)
          : undefined;
        const recentTemplateIds = new Set(chosenTemplateHistory.slice(-recentTemplateWindow));
        const intentTemplate = isKlingI2V
          ? forcedTemplate
          : isLearningComicPro && learningLayoutIntentForPage
            ? pickLearningTemplateByIntent(
              learningLayoutIntentForPage,
              params.templates,
              explicitTemplate || forcedTemplate,
              recentTemplateIds
            )
            : explicitTemplate || forcedTemplate;
        const requestedTemplate = isLearningComicPro && generatedPanelCount > 0
          ? pickLearningTemplateByPanelCount(
            params.templates,
            intentTemplate,
            generatedPanelCount,
            learningLayoutIntentForPage,
            recentTemplateIds
          )
          : intentTemplate;
        template = markTemplateUsage(isLearningComicPro ? requestedTemplate : pickDiversifiedTemplate(requestedTemplate));
        actualPanelCount = isWebtoon || isLearningComicPro ? template.panels.length : panelsPerPage;
        if (isWebtoon) webtoonPatternHistory.push(`static:${template.id}`);
      }

      if (isWebtoon) {
        scrollChoreographyForPage = finalizeWebtoonScrollChoreography({
          rawChoreography: p.scroll_choreography,
          pageNumber,
          totalPages: targetPageCount,
          dynamicLayout: dynamicLayoutForPage,
          narrativeFunction,
        });
      }

      const outlineEntry = outline?.page_outlines.find((entry) => entry.page_number === pageNumber);
      const buildSupplementalPanel = (panelIndex: number, targetAspectRatio: string) => ({
        scene: params.language === "ko"
          ? `${pageNumber}페이지의 "${outlineEntry?.sub_topic || "흐름"}"을 이어 주는 조용한 관찰 컷. 앞선 컷을 반복하지 말고, 자료 화면, 손짓, 표정, 배경 단서처럼 다른 시각 정보를 보여준다.`
          : `A quiet continuation beat for page ${pageNumber}, showing a different visual clue such as source material, a gesture, an expression, or a background detail without repeating an earlier panel.`,
        acting: params.language === "ko"
          ? "주인공이 앞선 설명을 다시 말하지 않고, 화면의 다른 단서를 바라보거나 손으로 가리킨다."
          : "The protagonist looks at or points to a different clue without repeating the previous explanation.",
        dialogues: [],
        camera: panelIndex === actualPanelCount - 1 ? "medium closing beat" : "small cutaway detail",
        mood: "quiet connective beat",
        target_aspect_ratio: targetAspectRatio
      });
      const normalizedPanels = Array.from({ length: actualPanelCount }, (_, pIdx) => {
        const templatePanelRatio =
          template.panels[pIdx]?.target_aspect_ratio ||
          template.panels[0]?.target_aspect_ratio ||
          i2vAspectRatio;
        const source = safePanels[pIdx] || buildSupplementalPanel(pIdx, templatePanelRatio);
        return {
          scene: String(source.scene || `Frame ${pIdx + 1}`),
          acting: String(source.acting || "Natural motion."),
          dialogues: Array.isArray(source.dialogues)
            ? source.dialogues.filter((d: unknown) => typeof d === "string")
            : [],
          camera: String(source.camera || "Eye-level"),
          mood: String(source.mood || "Neutral"),
          target_aspect_ratio: String(source.target_aspect_ratio || templatePanelRatio)
        };
      });

      return {
        page: { index: pageNumber, chapter_title: String(p?.chapter_title || `Page ${pageNumber}`) },
        layout: {
          template_id: template.id,
          canvas: template.canvas,
          gutter_px: isKlingI2V || isWebtoon ? 0 : isManga ? 6 : 12,
          border_px: isKlingI2V || isWebtoon ? 0 : isManga ? 3 : 4,
          border_radius_px: isKlingI2V || isWebtoon || isManga ? 0 : 16,
          background_color: "#FFFFFF",
          template_panels: template.panels,
          ...(learningLayoutIntentForPage ? { learning_layout_intent: learningLayoutIntentForPage } : {}),
          ...(dynamicLayoutForPage ? { webtoon_layout: dynamicLayoutForPage } : {}),
          ...(scrollChoreographyForPage ? { scroll_choreography: scrollChoreographyForPage } : {}),
          ...(isWebtoon ? { scroll: buildWebtoonScrollMeta({ template_id: template.id, webtoon_layout: dynamicLayoutForPage }, pageNumber, targetPageCount) } : {})
        },
        panels: normalizedPanels.map((pan, pIdx: number) => ({
          index: pIdx + 1,
          scene: pan.scene,
          acting: pan.acting,
          dialogues: pan.dialogues,
          camera: pan.camera,
          mood: pan.mood,
          render: {
            target_aspect_ratio: isKlingI2V ? i2vAspectRatio : pan.target_aspect_ratio,
            safe_area_hint: "Leave space at edges for dialogue"
          }
        }))
      };
    });
  };

  const runChunk = async (startIndex: number, count: number, priorTitles: string[], includePlanMeta: boolean, outlineContext: string, outline?: PlanOutline | null) => {
    const effectiveOutlineContext = isPaperStoryResearchPack ? "" : outlineContext;
    const pageOnlyContext = buildPaperPageOnlyContext(startIndex, count, outline);
    const baseContents = `${prompt}${effectiveOutlineContext}${pageRangeHint(startIndex, count, priorTitles, outline)}${pageOnlyContext}`;
    const contentsWithoutResearch = baseContents;
    const contentsWithResearch = isPaperStoryResearchPack ? baseContents : `${baseContents}${researchContext}`;
    const schema = includePlanMeta ? fullResponseSchema(count) : pagesOnlyResponseSchema(count);
    const enableSearch = includePlanMeta && shouldUsePlannerWebSearch;
    const resp = await requestPlanner(contentsWithResearch, schema, enableSearch, includePlanMeta ? "planner_full_plan" : "planner_pages_only");
    const json = safeParseJson(resp.text);
    debugChunks.push({
      start_index: startIndex,
      end_index: startIndex + count - 1,
      include_plan_meta: includePlanMeta,
      enable_search: enableSearch,
      contents_with_research: contentsWithResearch,
      contents_without_research: contentsWithoutResearch,
      response_json: json
    });
    return { json, grounding_sources: resp.sources };
  };

  // ========== PASS 1: OUTLINE (2+ pages only) ==========
  let outline: PlanOutline | null = null;
  let outlineSection = "";
  let outlineGroundingSources: GroundingSource[] = [];

  if (targetPageCount > 1) {
    try {
      const outlinePromptText = buildOutlinePrompt();
      const outlineContents = `${outlinePromptText}${researchContext}`;
      const enableOutlineSearch = shouldUsePlannerWebSearch;
      const outlineResp = await requestOutline(outlineContents, enableOutlineSearch);
      const outlineJson = safeParseJson(outlineResp.text);
      outlineGroundingSources = outlineResp.sources;

      const rawOutlines = Array.isArray(outlineJson?.page_outlines) ? outlineJson.page_outlines : [];
      const asStringArray = (value: unknown): string[] =>
        Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const normalizedOutlines = Array.from({ length: targetPageCount }, (_, i) => {
        const entry = rawOutlines[i];
        return sanitizePaperFirstOutlineEntry({
            page_number: i + 1,
            sub_topic: String(entry?.sub_topic || `Page ${i + 1}`),
            content_summary: String(entry?.content_summary || ""),
            narrative_function: String(entry?.narrative_function || "deepening"),
            learning_action: String(entry?.learning_action || ""),
            reader_question: String(entry?.reader_question || ""),
            opening_scene: String(entry?.opening_scene || ""),
            page_reveal: String(entry?.page_reveal || ""),
            dialogue_goal: String(entry?.dialogue_goal || ""),
            page_speech_flow: String(entry?.page_speech_flow || ""),
            dont_explain_yet: String(entry?.dont_explain_yet || ""),
            allowed_content: asStringArray(entry?.allowed_content),
            forbidden_content: asStringArray(entry?.forbidden_content),
            next_page_tease: String(entry?.next_page_tease || ""),
            density_note: String(entry?.density_note || ""),
            connection_to_previous: String(entry?.connection_to_previous || "")
          });
        });

      outline = {
        series_title: String(outlineJson?.series_title || params.topic),
        core_insight: String(outlineJson?.core_insight || ""),
        rationale: String(outlineJson?.rationale || ""),
        page_outlines: normalizedOutlines
      };
      outlineSection = formatOutlineForPrompt(outline);

      debugChunks.push({
        start_index: 0,
        end_index: 0,
        include_plan_meta: true,
        enable_search: enableOutlineSearch,
        contents_with_research: outlineContents,
        contents_without_research: outlinePromptText,
        response_json: outlineJson
      });
    } catch (outlineError) {
      console.warn("Outline generation failed, falling back to 1-pass mode:", outlineError);
      outline = null;
      outlineSection = "";
    }
  }

  // ========== PASS 2: PAGE SCRIPTS ==========
  const rawTitleHistory: string[] = [];
  const pages: PageSpec[] = [];
  let seriesTitle: string | null = outline?.series_title || null;
  let planMetaFromModel: any = null;
  let groundingSources: GroundingSource[] = [...outlineGroundingSources];

  let nextStartIndex = 1;
  while (pages.length < targetPageCount) {
    const remaining = targetPageCount - pages.length;
    let chunkSize = Math.min(remaining, maxPagesPerRequest);
    let lastError: any = null;

    while (chunkSize >= 1) {
      try {
        // Use fullResponseSchema only for 1-page comics or when outline failed for first chunk
        const needsPlanMeta = pages.length === 0 && !outline;
        const chunk = await runChunk(nextStartIndex, chunkSize, rawTitleHistory, needsPlanMeta, outlineSection, outline);
        groundingSources = mergeGroundingSources(groundingSources, chunk.grounding_sources);

        if (needsPlanMeta) {
          seriesTitle = typeof chunk.json?.series_title === "string" ? chunk.json.series_title : seriesTitle;
          planMetaFromModel = chunk.json?.plan_meta ?? null;
        }

        const rawPages = Array.isArray(chunk.json?.pages) ? chunk.json.pages : [];
        for (const p of rawPages) {
          const title = typeof p?.chapter_title === "string" ? p.chapter_title.trim() : "";
          if (title) rawTitleHistory.push(title);
        }

        pages.push(...mapPages(rawPages, nextStartIndex));
        nextStartIndex = pages.length + 1;
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (chunkSize === 1) break;
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));
      }
    }

    if (lastError) throw lastError;
  }

  const series_spec: SeriesSpec = {
    series: {
      title: seriesTitle || params.topic,
      language: params.language,
      audience_level: params.audience_level,
      page_count: pages.length
    },
    anchors: {
      protagonist: {
        appearance: params.character_description,
        role: params.character_role,
        reference_images: params.character_refs
      },
      product:
        params.product && Array.isArray(params.product.reference_images) && params.product.reference_images.filter(Boolean).length > 0
          ? {
            label: String(params.product.label || params.topic).trim() || params.topic,
            reference_images: params.product.reference_images.filter(Boolean)
          }
          : undefined,
      tone_mode: toneMode,
      tone_level: toneMode === "gag" ? toneLevel : undefined,
      cast: cast.length > 0 ? cast : undefined,
      supporting_cast: params.supporting_cast?.trim() || undefined,
      style: params.style,
      delivery: params.delivery_style
    },
    constraints: {
      comic_mode: params.comic_mode,
      output_mode: outputMode,
      publication_format: publicationFormat,
      manga_color_mode: mangaColorMode,
      i2v_aspect_ratio: i2vAspectRatio,
      text_strategy: publicationFormat === "webtoon" ? "embed_in_image" : "blank_bubbles_then_overlay",
      layout_variety: params.layout_variety,
      image_size: params.image_size,
      character_consistency_mode: characterConsistencyMode
    }
  };

  const planMetaTag = isPureCinematic
    ? "시네마틱 로그라인"
    : introStyle === "myth_busting" && !isAnyCinematic
      ? "오해 깨기 한 줄"
      : "학습 흐름 한 줄";
  const planMetaFallbackRationale = isPureCinematic
    ? "Automated cinematic story flow."
    : isEduCinematic
      ? "Automated edu-cinematic flow."
      : "Automated educational flow.";

  const plan_meta = {
    recommended_page_count: pages.length,
    page_count_used: pages.length,
    total_panels: pages.reduce((sum, p) => sum + p.panels.length, 0),
    detail_level: params.detail_level === "brief" ? 0 : params.detail_level === "detailed" ? 2 : 1,
    rationale_short: `${(outline?.core_insight || planMetaFromModel?.core_insight) ? `[${planMetaTag}: ${outline?.core_insight || planMetaFromModel?.core_insight}] ` : ""}${outline?.rationale || planMetaFromModel?.rationale || planMetaFallbackRationale}`,
    beats: outline
        ? outline.page_outlines.map((entry, idx) => ({
            id: `beat-${idx + 1}`,
            title: entry.sub_topic,
            type: entry.learning_action || entry.narrative_function,
            weight: 1
          }))
      : (planMetaFromModel?.beats || []),
    layout_variety: params.layout_variety,
    layout_history_used: pages.map(p => p.layout.template_id),
    grounding_sources: usingProvidedResearch ? (researchSources.length > 0 ? researchSources : groundingSources) : groundingSources
  };

  const debug: PlannerDebugInfo = {
    model: getGeminiPlannerModel(),
    max_output_tokens: getGeminiPlannerMaxOutputTokens(getGeminiMaxOutputTokens()),
    reasoning_effort: geminiReasoningEffort,
    created_at: startedAt,
    system_instruction: systemInstruction,
    outline: outline || undefined,
    chunks: debugChunks,
    ...(webtoonPatternSelectionDebug.length > 0 ? { webtoon_pattern_selection: webtoonPatternSelectionDebug } : {})
  };

  return { series_spec, pages, plan_meta, debug };
};

/* ================================================================
 *  generateStoryPlan — 스토리/창작 모드 전용 플래너
 *  대본·소설·시나리오 텍스트를 웹툰/망가 패널 스크립트로 각색
 * ================================================================ */

export const generateStoryPlan = async (params: {
  script_text: string;
  story_input_type: StoryInputType;
  genre?: StoryGenre;
  pacing?: PacingPreference;
  age_rating: AgeRating;
  detail_level: ScriptDetail;
  language: Language;
  delivery_style?: DeliveryStyleSpec;
  tone_mode?: ToneMode;
  tone_level?: ToneLevel;
  layout_variety: LayoutVariety;
  image_size: ImageSize;
  page_count: number;
  publication_format: PublicationFormat;
  manga_color_mode?: MangaColorMode;
  i2v_aspect_ratio?: I2VAspectRatio;
  character_consistency_mode?: CharacterConsistencyMode;
  character_description: string;
  character_role: NarrativeRole;
  character_refs: { main: string; pack: string[] };
  product?: { label: string; reference_images: string[] };
  supporting_cast?: string;
  cast?: CharacterSpec[];
  style: SeriesSpec['anchors']['style'];
  templates: LayoutTemplate[];
  digest_notes?: string;
  story_anti_education_guard?: boolean;
  gemini_reasoning_effort?: GeminiReasoningEffort;
}): Promise<SeriesPlan> => {
  const startedAt = Date.now();
  if (!Array.isArray(params.templates) || params.templates.length === 0) {
    throw new Error("Planner requires at least one layout template.");
  }

  const templateSummaries = params.templates.map(t => ({
    id: t.id, label: t.label, tier: t.variety_tier,
    panels: t.panels.length,
    ratios: t.panels.map(p => p.target_aspect_ratio)
  }));
  const webtoonAnchorTemplateSummaries = getWebtoonAnchorTemplateSummaries(params.templates);

  const publicationFormat: PublicationFormat = params.publication_format;
  const mangaColorMode: MangaColorMode = params.manga_color_mode || "bw";
  const isKlingI2V = publicationFormat === "kling_i2v";
  const isWebtoon = publicationFormat === "webtoon";
  const isManga = publicationFormat === "manga";
  const isLearningComic = publicationFormat === "learning_comic";
  const isLearningComicPro = isLearningComic && params.layout_variety === "high";
  const isDynamicLayout = isWebtoon;
  const panelsPerPage = isKlingI2V ? 1 : isManga ? 6 : isWebtoon ? 3 : 4;
  const minPanels = isLearningComicPro ? 3 : isWebtoon ? 1 : isDynamicLayout ? 2 : panelsPerPage;
  const maxPanels = isLearningComicPro ? 7 : isDynamicLayout ? 5 : panelsPerPage;
  const i2vAspectRatio: I2VAspectRatio = params.i2v_aspect_ratio || "16:9";
  const characterConsistencyMode: CharacterConsistencyMode = params.character_consistency_mode || "loose";
  const geminiReasoningEffort: GeminiReasoningEffort = params.gemini_reasoning_effort || "medium";
  const webtoonAnchorGuidance = isWebtoon
    ? getWebtoonAnchorGuidance(webtoonAnchorTemplateSummaries, params.page_count)
    : "";
  const toneMode: ToneMode = params.tone_mode || "normal";
  const toneLevel: ToneLevel = params.tone_level || "medium";
  const pacing: PacingPreference = params.pacing || "balanced";
  const genre = params.genre;
  const storyAntiEducationGuardEnabled = params.story_anti_education_guard !== false;

  // ── Age Rating guardrails ──
  const ageRatingInstruction = (() => {
    if (params.age_rating === "all_ages") return `
[연령 등급: 전체 이용가]
- 폭력/공포/선정성/비하/욕설은 금지입니다.
- 긴장감은 모험/우정/발견 중심으로만 구성하세요.
- 대사는 쉬운 단어, 짧은 문장으로 작성하세요.`;
    if (params.age_rating === "teen") return `
[연령 등급: 청소년 (PG-13)]
- 비고어(PG-13) 범위의 액션/격투/충돌은 허용됩니다.
- 유혈/고어/잔혹/노골적 성적 묘사/혐오/비하는 금지입니다.
- 속도감 있는 장르 문법(추격, 반전, 감정 충돌)을 활용하세요.`;
    return `
[연령 등급: 성인 (Mature)]
- 복잡한 감정, 도덕적 딜레마, 어두운 주제를 허용합니다.
- 고어/잔혹 묘사와 노골적 성적 묘사는 여전히 금지입니다.
- 서브텍스트와 여백을 적극 활용하세요. 대사는 짧되 함의는 깊게.`;
  })();

  // ── Genre hint ──
  const genreInstruction = genre ? `
[장르 힌트: ${genre}]
- 이 장르의 관습과 분위기를 존중하되, 클리셰에 매몰되지 마세요.
- 장르에 맞는 시각적 연출(카메라, 조명, 구도)을 적극 활용하세요.` : "";

  // ── Pacing ──
  const pacingInstruction = `
[페이싱: ${pacing}]${pacing === "fast"
    ? "\n- 빠른 전개: 컷마다 상황이 급변합니다. 여백/침묵 최소화. 대사는 짧고 임팩트 있게."
    : pacing === "slow"
      ? "\n- 느린 전개: 감정/분위기/디테일을 천천히 쌓아가세요. 침묵/여백/시선 연출을 활용하세요."
      : "\n- 균형 잡힌 전개: 긴장과 이완을 교차시키세요. 클라이맥스 전에 적절한 빌드업."}`;

  // ── Input type instructions ──
  const inputTypeInstruction = (() => {
    if (params.story_input_type === "script") return `
[입력 형태: 대본/시나리오]
- 사용자가 대사와 지문이 포함된 대본을 제공했습니다.
- 대본의 대사를 최대한 보존하면서 패널에 배치하세요.
- 지문/무대 지시를 scene/acting/camera/mood로 변환하세요.
- 대본에 명시되지 않은 장면 전환이나 카메라 앵글은 만화적 연출로 보강하세요.`;
    if (params.story_input_type === "prose") return `
[입력 형태: 소설/산문]
- 사용자가 소설이나 산문 텍스트를 제공했습니다.
- 텍스트에서 시각적으로 강렬한 장면(행동, 감정 변화, 대화)을 선별하세요.
- 서술/묘사를 scene/acting/camera/mood로 변환하세요.
- 직접 인용된 대사는 dialogues로 보존하고, 간접 화법은 시각적 연기로 전환하세요.
- 모든 내용을 담으려 하지 말고, 핵심 장면 위주로 각색하세요.`;
    return `
[입력 형태: 시나리오/상황 설명]
- 사용자가 간략한 상황이나 설정을 제공했습니다.
- 이 상황을 구체적인 장면, 대사, 행동이 있는 완전한 스토리로 확장하세요.
- 인물의 욕망/갈등/선택/결과를 포함한 드라마틱한 구조를 만드세요.
- 설정에 명시되지 않은 세부사항은 창의적으로 채워주세요.`;
  })();

  // ── Tone ──
  const toneModeInstruction = toneMode === "gag" ? `
[톤 모드: 개그]
- 서사의 긴장감을 해치지 않는 선에서 리드미컬한 유머를 넣으세요.
- 개그 방식: 상황 아이러니/리액션/타이밍 중심.
- 개그 강도: ${toneLevel}${toneLevel === "low" ? " (분위기를 깨지 않는 짧은 위트 0~1회)" : toneLevel === "high" ? " (컷마다 코미디 리듬 유지, 플롯 긴장은 보존)" : " (장면 전환마다 가벼운 코미디 비트)"}
- 금지: 욕설/혐오/조롱/비하/노골적 성적 표현.` : `
[톤 모드: 일반]
- 장르 톤에 맞는 자연스러운 감정선과 리듬을 우선하세요.`;

  // ── Delivery ──
  const deliveryInstruction = params.delivery_style ? `
[말투 & 제스처]
- 프리셋: ${params.delivery_style.preset_label}
- 지침: ${params.delivery_style.instruction}
- dialogues: 말투/어투는 프리셋을 따르세요.
- dialogues: 프리셋을 따르더라도 한 가지 종결어미에 고정하지 마세요. 특히 친절한 설명 톤을 "~요/~예요/~해요" 반복으로만 처리하면 실패입니다.
- acting: 표정/몸짓/손동작을 최소 1개 이상 구체적으로 적으세요.
- 금지: 제스처 지시를 dialogues에 넣지 마세요.
- 안전 규칙: 욕설/비하/혐오/노골적 성적 묘사는 금지입니다.` : `
[말투 & 제스처 - 기본]
- 장르 톤에 맞는 자연스러운 구어체로 유지하세요.
- acting에는 표정/몸짓/속도감을 구체적으로 작성하세요.`;

  // ── Character consistency ──
  const characterConsistencyInstruction = characterConsistencyMode === "strict" ? `
[캐릭터 일관성: 엄격(STRICT)]
- 캐릭터의 얼굴/헤어/체형/복장은 전체에서 동일하게 유지하세요.
- '갈아입음/변장/시간 점프' 등이 명시된 경우에만 변경을 허용합니다.` : "";

  // ── Cast ──
  const cast = Array.isArray(params.cast) ? params.cast : [];
  const castProtagonists = cast.filter(c => c?.role === "protagonist");
  const castSupporting = cast.filter(c => c?.role === "supporting");
  const freqLabel = (freq?: CharacterSpec["catchphrase_frequency"]) => {
    if (freq === "often") return "자주";
    if (freq === "sometimes") return "가끔";
    return "드물게";
  };
  const formatCharacterLine = (c: CharacterSpec): string => {
    const name = String(c.name || "").trim() || "이름없음";
    const parts: string[] = [name];
    if (c.appearance) parts.push(`외형/복장: ${c.appearance.trim()}`);
    if (c.persona) parts.push(`페르소나: ${c.persona.trim()}`);
    if (c.catchphrase) parts.push(`말버릇(${freqLabel(c.catchphrase_frequency)}): "${c.catchphrase.trim()}"`);
    return parts.join(" / ");
  };
  const castInstruction = (castProtagonists.length > 0 || castSupporting.length > 0) ? `
[캐스트]
${isKlingI2V
    ? '- I2V 모드: dialogues는 화자 포함 형식("화자: 대사")을 권장합니다.'
    : "- 대사(dialogues)에는 화자 이름을 절대 넣지 마세요."}
주연: ${castProtagonists.length > 0 ? castProtagonists.map(c => `\n- ${formatCharacterLine(c)}`).join("") : "\n- (없음)"}
조연: ${castSupporting.length > 0 ? castSupporting.map(c => `\n- ${formatCharacterLine(c)}`).join("") : "\n- (없음)"}` : "";

  // ── Format-specific framework ──
  const frameworkInstruction = (() => {
    if (isKlingI2V) return `
[포맷: Kling I2V 스토리보드]
- 페이지당 1프레임. scene/acting/camera/mood를 구체적으로 작성.
- dialogues는 음성 대사(0~2줄), 화자 포함 형식("화자: 대사").
- 자막/말풍선/화면 텍스트 지시 금지.`;
    if (isWebtoon) return `
[포맷: 웹툰 모바일 페이지 — 다이나믹 레이아웃]
- 정적 앵커 템플릿(template_id)은 최대 2페이지까지만, 정말 필요한 경우에만 사용하세요.
- 정적 앵커는 도입(webtoon_hero_stack), 호흡(webtoon_stack_3 또는 webtoon_stack_4), 단일 임팩트/엔딩(webtoon_impact)에만 사용하세요.
- 정적 앵커 페이지를 선택했다면 template_id만 사용하고 webtoon_layout은 생략하세요.
- 동적 페이지가 기본입니다. 특별한 이유가 없다면 template_id를 비우고 webtoon_layout만 사용하세요.
- 동적 페이지는 스트립당 2~5컷. core_pattern은 매 페이지 1개: stack_focus|hero_drop|split_row|stair_step|closeup_pulse|impact_tail|vertical_panorama|void_reveal|continuity_chain|motion_runway|one_point_charge
- modifiers는 0~2개만 선택: borderless_open|inset_closeup|diagonal_cut|overlap_bleed|long_pause_gap|micro_reaction
- gap_profile은 tight|balanced|breathing|dramatic 중 하나.
- focus_panel_index는 가장 강조할 패널 번호.
- 높이 가중치(height_weight): dialogue=2, action=4, emotional=3, establishing=3, transition=1, impact=5, closeup=2
- webtoon_layout.panel_heights 배열과 panels 배열 길이가 panel_count와 같아야 합니다.
- 대화 장면→짧고 좁은 portrait-leaning 패널, 액션/감정→큰 패널, 반전→impact 풀블리드 패널.
- 매 페이지를 똑같은 전폭 직사각형 세로 3단으로 반복하지 마세요.
- 같은 폭의 전폭 가로 직사각형이 3번 연속 반복되지 않게 하세요.
- 모바일 웹툰 페이지 기준이지만 split_row / stair_step / vertical_panorama / void_reveal / continuity_chain / motion_runway / one_point_charge / inset_closeup 같은 변주로 세로 읽기 리듬을 만드세요.
- 클리프행어/감정 고조는 focus_panel_index 또는 마지막 패널에 배치.
- 모든 웹툰 페이지에는 scroll_choreography를 함께 작성하세요. canvas_size는 항상 "1024x3072"입니다.
- scroll_choreography.choreography_pattern은 ${WEBTOON_SCROLL_PATTERN_DOC} 중 하나입니다.
- scroll_choreography.beats는 2~6개이며 kind는 ${WEBTOON_SCROLL_BEAT_KIND_DOC} 중 하나입니다.
- panel만 반복하지 마세요. 4개 이상의 beats라면 pause_space, bubble_space, borderless_scene, reaction_micro, transition_air 중 최소 2개 이상을 반드시 포함하세요.
- panel이 3개 이상 연속되면 실패입니다. 비패널 구간의 height_weight 합은 전체의 최소 35% 정도가 되게 하세요.
- 각 beat에는 width_profile(${WEBTOON_SCROLL_WIDTH_PROFILE_DOC}), x_position(${WEBTOON_SCROLL_X_POSITION_DOC}), shape_style(${WEBTOON_SCROLL_SHAPE_STYLE_DOC}), vertical_role(${WEBTOON_SCROLL_VERTICAL_ROLE_DOC}), scroll_distance(${WEBTOON_SCROLL_DISTANCE_DOC})를 작성하세요.
- full width만 반복하지 말고 medium/narrow/tiny 컷을 최소 2개 섞으세요. x_position도 전부 center가 되면 안 됩니다.
- borderless, diagonal, inset, overlap 중 최소 1개 이상을 포함하고, vertical_role에는 pause/drop/reveal 중 최소 1개 이상을 포함하세요.
- 대화는 dialogue_air/micro_reaction_chain, 감정/리빌은 emotional_pause_reveal/impact_drop, 액션은 action_runway/vertical_panorama를 우선하세요.${webtoonAnchorGuidance}`;
    if (isManga) return `
[포맷: 일본 만화]
- 페이지당 ${panelsPerPage}컷. 읽기 순서: 오른쪽→왼쪽, 위→아래.
- 만화적 연출: 스피드 라인, 집중선, 리액션 컷, 극적 클로즈업.
- 패널 크기 변화로 리듬감 구성.
${mangaColorMode === "bw" ? "- 흑백 스크린톤 스타일." : "- 풀컬러 만화 스타일."}`;
    return isLearningComicPro ? `
[포맷: 학습만화 프로]
- 페이지마다 선택한 템플릿에 맞춰 3~7컷을 사용하세요.
- 먼저 필요한 장면 비트 수를 정한 뒤, 그 컷 수와 같은 템플릿을 고르세요. 부족한 컷을 같은 장면 반복으로 채우면 실패입니다.
- 컷 수를 늘리는 목적은 설명을 쪼개기 위해서가 아니라 토론, 근거 추적, 오개념 교정, 퀴즈 긴장, 원인-결과 흐름을 실제 만화 페이지처럼 배치하기 위해서입니다.` : `
[포맷: 만화 (4컷)]
- 페이지당 ${panelsPerPage}컷.
- 기승전결 구조로 한 페이지에 서사 단위를 완결하세요.`;
  })();

  // ── Detail level ──
  const detailInstruction = params.detail_level === "brief" ? `
[디테일: BRIEF]
- 대사는 0~2줄로 간결하게. scene/acting은 구체적으로.` : params.detail_level === "detailed" ? `
[디테일: DETAILED]
- 대사는 1~3개의 자연스러운 발화 단위로 쓰세요. 먼저 의미가 완결되는 자연스러운 한 호흡을 만드세요.
- 그 한 호흡이 길어지면(한국어 약 32~38자 이상 / 영어 약 12~14단어 이상) 두 문장으로 억지 변환하지 말고, 독자가 하나의 설명 흐름으로 이어 읽을 수 있게 다음 컷의 이어지는 발화, 짧은 리액션, [narration] 박스로 넘기세요. 숫자를 맞추려고 문장을 억지로 자르지 마세요.
- scene/acting에 카메라 렌즈감, 동선 블로킹, 리액션 비트를 명시.` : `
[디테일: NORMAL]
- 대사는 1~3줄 중심. 감정선에 맞춰 군더더기 없이 쓰세요.`;

  // ── Language ──
  const languageInstruction = params.language === "en" ? `
[언어: 영어]
- 모든 출력 텍스트는 자연스러운 영어로 작성. 한국어 금지.` : `
[언어: 한국어]
- 모든 출력 텍스트는 자연스러운 한국어로 작성. 불필요한 영어 남발 금지.`;

  const sentenceEndingRhythmInstruction = params.language === "ko"
    ? `- 같은 페이지의 말풍선들이 모두 같은 설명형 종결어미로 끝나지 않게 하세요. 특히 "~요/~예요/~이에요" 계열을 연속 반복해 정의문 목록처럼 만들지 마세요.
- 한 페이지의 설명자/가이드 대사가 모두 같은 어미 계열로 끝나면 실패입니다. "~예요/~이에요", "~해요/~돼요", "~볼게요/~갈게요", "~주세요" 같은 존댓말 설명 종결을 같은 페이지에서 반복하지 마세요.
- 설명자/가이드 대사에는 최소 3가지 이상의 종결 리듬을 섞으세요: 질문형, 관찰형, 이유/원리형, 짧은 반응형, 명사형 정리, 행동 유도형 중 장면에 맞게 분산합니다.
- 행동 유도형("~해볼게요", "~맞춰주세요", "~가요")은 한 페이지에 많이 쓰면 튜토리얼처럼 보입니다. 꼭 필요한 컷에만 1번 정도 사용하세요.
- 문장 기능을 섞으세요: 관찰, 질문, 짧은 반응, 원인/결과 연결, 다음 행동 제안, 확인/정리 중 장면에 맞는 기능을 배치하세요.`
    : "- Do not end every bubble with the same explanatory sentence pattern. Mix observations, questions, short reactions, cause/effect links, next-action prompts, and brief check/summary beats.";

  const storyLearningComicDialogueArcInstruction = isLearningComic && !storyAntiEducationGuardEnabled ? `
[학습만화 페이지 대화 아크]
- 각 페이지는 패널별 독립 설명문 묶음이 아니라, 하나의 짧은 장면처럼 이어져야 합니다.
- 페이지 안의 대화 흐름을 먼저 정하세요: 첫 장면 → 독자 질문 → 관찰 → 원리/이름 연결 → 작은 깨달음 중 필요한 기능만 배치합니다.
- 각 패널의 dialogues는 서로 다른 기능을 가져야 합니다. 질문, 관찰, 짧은 반응, 원인/결과 연결, 다음 행동 제안, 확인/정리 중 장면에 맞게 섞으세요.
- 모든 컷이 독립된 설명문으로 닫히면 실패입니다. 앞 컷의 시각 정보가 다음 컷의 발화나 행동으로 이어지게 작성하세요.
- 설명자/가이드의 말만 이어 붙여 읽었을 때 발표문, 설명서, 순서표처럼 들리면 실패입니다. 생활 속 질문이나 관찰에서 시작해, 현상이 눈앞에서 이어지는 말 흐름으로 다시 쓰세요.
- 보조 캐릭터가 없으면 주인공이 눈앞의 현상을 관찰하고 반응하며 다음 행동으로 이어가면 됩니다.
- 아웃라인/기획 지시를 캐릭터가 직접 말하게 하지 마세요. "아직 원리를 다 말하지 말고", "먼저 이 장면을 보세요", "이번 페이지는 상황을 느끼는 페이지입니다" 같은 내부 규칙 문장은 dialogues에 절대 쓰지 마세요.
- 별도 필드를 추가하지 말고, 이 대화 아크가 scene/acting/dialogues/camera에 자연스럽게 드러나게 작성하세요.` : "";

  const storyLearningComicScriptDistributionInstruction = isLearningComic && !storyAntiEducationGuardEnabled ? `
[학습만화 전체 스크립트 분배]
- 한 페이지는 하나의 학습 행동만 담당합니다.
- 정의/뜻/사용 상황/예문/해석/주의점/요약을 한 페이지에 모두 넣지 마세요.
- 페이지 목표는 상황 느끼기, 필요성 발견, 이름 붙이기, 예문 확인, 비교하기, 오해 바로잡기, 연습하기, 정리하기 중 하나에 가깝게 잡으세요.
- reader_question/opening_scene/page_reveal/dialogue_goal/dont_explain_yet이 있으면 반드시 따르세요. 특히 dont_explain_yet에 적힌 정보는 해당 페이지에서 대사/나레이션으로 먼저 말하지 마세요.
- 한 페이지의 content_summary에 서로 다른 학습 행동이 2개 이상 섞이면 과밀입니다. 덜 중요한 설명은 다음 페이지/그림/생략 대상으로 보내세요.
- learning_action, reader_question, opening_scene, page_reveal, dialogue_goal, dont_explain_yet, density_note는 내부 제작 메모입니다. 이 단어들이나 그 뜻풀이를 캐릭터 대사, 나레이션, 화면 텍스트로 노출하지 마세요.
- 영어/언어 문법 주제는 개념 이름이나 뜻부터 시작하지 말고, 실제로 그 표현이 필요한 상황을 먼저 보여주세요.` : "";

  const storyLearningComicNaturalSpeechInstruction = isLearningComic && !storyAntiEducationGuardEnabled
    ? params.language === "ko"
      ? `- 학습 설명 대사는 번역문, 설명서, 교과서 요약, 발표 대본처럼 쓰지 말고 실제 사람이 아이에게 쉽게 말해주는 입말로 쓰세요.
- "오늘은 ~ 배워요", "관찰 대상", "장치예요", "잘 진행돼요", "단계로 넘어가"처럼 일상 대화에서 잘 쓰지 않는 표현을 피하세요.
- 독자가 이미 아는 생활어는 과하게 풀지 마세요. "빠르게 돌려 물기를 줄이는 단계"처럼 늘이지 말고, 맥락상 자연스러우면 "탈수"처럼 짧은 생활어를 씁니다.
- "먼저/그러면/이때/그다음/마지막으로" 같은 접속사를 문장마다 앞에 붙여 순서표처럼 만들지 마세요.
- "~해", "~만들어", "~빼", "~줄여"처럼 독자가 행동 지시로 읽을 수 있는 종결을 연속해서 쓰지 말고, 현상 관찰/상태 변화/이유 설명/정리 문장으로 종결을 섞으세요.
- "~이에요", "~해요", "~돼요", "~볼게요", "~주세요"처럼 같은 높임말 설명 종결이 이어지면 기계적인 선생님 말투가 됩니다. 설명자/가이드 말만 이어 붙였을 때 같은 어미 계열이 3번 이상 반복되면 다시 쓰세요.
- 반말 캐릭터면 반말 안에서도 "~야", "~거든", "~지", "~잖아", "~거야", 짧은 감탄/명사형 정리를 섞고, 존댓말 캐릭터면 존댓말 안에서도 질문/관찰/정리/리액션의 끝맺음을 섞으세요. 한 가지 말끝으로 통일하지 마세요.
- 설명자/가이드 말만 이어 붙여 읽었을 때 말풍선으로 쪼갠 설명문 목록처럼 들리면, 생활감 있는 질문/관찰에서 시작하는 설명 대화로 다시 쓰세요.`
      : `- Learning dialogue must not sound like a translated textbook, instruction manual, slide script, or step list.
- Open from a familiar everyday question, observation, or small problem instead of "Today we will learn about...".
- Do not over-explain familiar everyday actions. Use the natural term when readers already know it.
- Avoid starting every sentence with mechanical connectors such as "first", "then", "next", and "finally".
- Avoid a run of imperative-like or procedural endings. Explain what is happening, why it changes, and what that means.
- Before finalizing, read only the guide/narrator dialogue in sequence. If it sounds like a manual split into bubbles, rewrite it as one natural explanation scene.`
    : "";

  // ── Dialogue rules ──
  const dialogueRule = isKlingI2V
    ? `- dialogues는 음성 대사(0~2줄). 화자 포함 형식("화자: 대사") 권장.`
    : `- dialogues에는 화자 이름 표시 금지. 순수 대사만 작성하세요.`;

  // ── Build system instruction ──
  const systemInstruction = `당신은 텍스트를 시각적 만화 패널 스크립트로 각색하는 세계 최고 수준의 비주얼 스토리텔링 각색가입니다.

[임무]
- 사용자가 제공한 텍스트(대본/소설/시나리오)를 만화 패널 스크립트로 변환하세요.
${storyAntiEducationGuardEnabled ? "- 교육적 프레이밍, 해설, 강의체 문장은 금지입니다. 순수 스토리텔링만 하세요.\n" : ""}- 장면성과 감정 흐름이 살아 있는 읽기 경험을 우선하세요.
- 각 패널에 scene(장면 묘사), acting(연기 지시), dialogues(대사), camera(카메라), mood(분위기)를 작성하세요.

${inputTypeInstruction}
${ageRatingInstruction}
${toneModeInstruction}
${genreInstruction}
${pacingInstruction}
${frameworkInstruction}
${isLearningComicPro ? `
[학습만화 프로 레이아웃 디렉팅]
- 페이지 크기는 유지하되, 장면 목적에 맞는 3~7컷 template_id와 learning_layout_intent를 함께 작성하세요.
- 프로 레이아웃은 4컷 고정이 아닙니다. 먼저 이 페이지에 필요한 장면 비트 수를 정하고, 그 컷 수와 정확히 같은 template_id를 고르세요.
- 선택한 template_id의 컷 수와 panels 배열 길이는 반드시 같아야 합니다. 4컷만 만들었다면 5~7컷 템플릿을 고르지 마세요.
- learning_layout_intent.role은 ${LEARNING_LAYOUT_ROLE_DOC} 중 하나입니다.
- visual_flow는 ${LEARNING_LAYOUT_FLOW_DOC} 중 하나, density는 ${LEARNING_LAYOUT_DENSITY_DOC} 중 하나입니다.
- focus_panel_index는 선택한 템플릿 컷 수 안에서 가장 중요한 컷 번호입니다. 마지막 반전/후킹이면 마지막 컷, 도입 이미지가 중요하면 1을 우선하세요.
- debate/collision은 debate_collision_5 또는 myth_fact_split_5, investigation/evidence_stack은 investigation_board_7 또는 zoom_cascade_5, process/cutaway는 process_cutaway_6, quiz/reveal은 quiz_tension_6 또는 impact_reveal_3, misconception은 misconception_crack_5, timeline은 timeline_burst_6, cause_effect는 cause_effect_chain_6, experiment는 experiment_failure_7을 우선하세요.
- template_reason에는 왜 그 템플릿이 이 장면 흐름에 맞는지 한 문장으로 적으세요.` : ""}
${storyLearningComicDialogueArcInstruction}
${storyLearningComicScriptDistributionInstruction}
${detailInstruction}
${languageInstruction}

[텍스트 규정]
${dialogueRule}
- 번역투/설명투 문장 금지. 진짜 사람이 아주 자연스러운 말투로 말하듯 작성하세요.
- dialogues는 실제 사람이 장면 안의 상대에게 말하는 발화처럼 작성하세요. 표제어, 목록, 발표 슬라이드, 요약 카드 같은 문장 금지.
- 제작 지시/규칙/자기검사 문장을 대사로 쓰지 마세요. "아직 원리를 다 말하지 말고", "먼저 이 장면을 잘 보면", "이 페이지에서는", "학습 행동", "밀도 점검" 같은 메타 표현은 금지입니다.
- 명사구/단어 조각만 단독으로 쓰지 마세요. 모든 대사는 앞뒤 맥락이 없어도 사람이 실제로 말한 한마디처럼 읽혀야 합니다.
- 필요한 정보는 장면 안에서 실제로 오갈 법한 말로 녹여 쓰세요. 독자에게 뜬금없이 설명하거나, 설명 카드처럼 정보를 나열하지 마세요.
- 말풍선은 글자 수가 아니라 자연스러운 한 호흡 기준으로 쓰세요. 그 한 호흡이 길어지면(한국어 약 32~38자 이상 / 영어 약 12~14단어 이상) 한 말풍선에 우겨넣지 마세요.
- 같은 화자의 한 감정/생각/설명 흐름을 여러 말풍선으로 딱딱 끊지 마세요.
- 숫자를 맞추려고 문장 중간을 자르지 마세요.
- 정보 밀도가 높아지면 문장만 잘게 썰거나 두 개의 별도 문장으로 바꾸지 말고, 독자가 하나의 설명 흐름으로 이어 읽도록 컷 전환/리액션/나레이션 박스로 넘기세요.
${sentenceEndingRhythmInstruction}
${storyLearningComicNaturalSpeechInstruction}

[주인공 설정]
- 주인공 외모: ${params.character_description}
- 주인공 역할: ${params.character_role === "narrator" ? "제3자 관찰자/촉발자" : "서사의 중심 배우"}
${castInstruction}${characterConsistencyInstruction}${deliveryInstruction}
${params.digest_notes ? `\n[STORY DIGEST (편집자 노트)]\n${params.digest_notes}\n- 위 다이제스트는 사전 분석된 각색 메모입니다. 장면 구성과 페이싱에 참고하세요.\n` : ""}
[형식 규정]
${isDynamicLayout
    ? `- 웹툰 페이지는 기본적으로 동적 레이아웃을 사용하되, 전체에서 최대 2페이지만 정적 앵커 템플릿을 허용하세요.
- 동적 페이지: 2~5개의 패널을 생성하고 webtoon_layout(panel_count, panel_heights, core_pattern, modifiers, gap_profile, focus_panel_index)를 포함하세요.
- 정적 앵커 페이지: template_id를 사용하고, panels 배열 길이를 해당 템플릿 컷 수에 맞추세요.
- modifiers는 보통 0~1개, 중요한 페이지도 최대 2개까지만 사용하세요.
- 특별한 이유가 없다면 template_id 없이 webtoon_layout만 사용하세요.
- 대화/리액션/클로즈업은 좁은 portrait-leaning 컷을 자주 사용하고, 전폭 가로 패널의 연속 반복을 피하세요.
- 레이아웃: 하이브리드 (대부분 동적 + 소수 정적 앵커)${webtoonAnchorGuidance}`
    : `${isLearningComicPro
      ? "- 프로 학습만화 페이지는 template_id를 반드시 사용하고, panels 배열 길이를 해당 템플릿 컷 수(3~7컷)에 정확히 맞추세요."
      : `- 페이지당 정확히 ${panelsPerPage}개의 패널을 생성하세요.`}
- 가용 템플릿: ${JSON.stringify(templateSummaries)}
${isLearningComicPro ? "- 프로 레이아웃에서는 template_id와 learning_layout_intent를 페이지마다 반드시 함께 작성하세요." : ""}`}`;

  // ── Schemas (reuse same patterns as generatePlan) ──
  const panelSchema = {
    type: Type.OBJECT,
    properties: {
      scene: { type: Type.STRING, description: "구체적인 장면 묘사" },
      acting: { type: Type.STRING, description: "캐릭터의 제스처/표정/몸짓" },
      dialogues: {
        type: Type.ARRAY, items: { type: Type.STRING },
        description: isKlingI2V ? "음성 대사(0~2줄). 화자 포함 형식 권장." : "대사 내용만. 독백/내면=[thought] 접두사, 나레이션/해설=[narration] 접두사. 일반 대사는 접두사 없이."
      },
      camera: { type: Type.STRING },
      mood: { type: Type.STRING },
      target_aspect_ratio: { type: Type.STRING }
    },
    required: ["scene", "acting", "dialogues", "target_aspect_ratio"]
  };

  const webtoonLayoutSchema = {
    type: Type.OBJECT,
    properties: {
      panel_count: { type: Type.NUMBER, description: "이 스트립의 패널 수 (2~5)" },
      core_pattern: { type: Type.STRING, description: `핵심 패턴 1개 선택: ${WEBTOON_CORE_PATTERN_DOC}` },
      modifiers: {
        type: Type.ARRAY,
        items: { type: Type.STRING, description: `선택 modifier: ${WEBTOON_MODIFIER_DOC}` },
        minItems: "0",
        maxItems: "2"
      },
      gap_profile: { type: Type.STRING, description: `컷 간 여백 리듬: ${WEBTOON_GAP_PROFILE_DOC}` },
      focus_panel_index: { type: Type.NUMBER, description: "시각적으로 가장 강조할 패널 번호 (1-based)" },
      panel_heights: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            scene_type: { type: Type.STRING, description: "dialogue|action|emotional|establishing|transition|impact|closeup" },
            height_weight: { type: Type.NUMBER, description: "패널 높이 가중치 (1=짧음, 5=매우 큼)" },
          },
          required: ["scene_type", "height_weight"]
        }
      }
    },
    required: ["panel_count", "core_pattern", "modifiers", "gap_profile", "focus_panel_index", "panel_heights"]
  };

  const webtoonScrollChoreographySchema = {
    type: Type.OBJECT,
    properties: {
      segment_index: { type: Type.NUMBER, description: "현재 웹툰 세그먼트 번호. 페이지 번호와 같게 둡니다." },
      canvas_size: { type: Type.STRING, description: "항상 1024x3072" },
      segment_role: { type: Type.STRING, description: "intro|beat|pause|climax|outro 중 하나" },
      choreography_pattern: { type: Type.STRING, description: `세로 웹툰 연출 패턴: ${WEBTOON_SCROLL_PATTERN_DOC}` },
      beats: {
        type: Type.ARRAY,
        description: "4개 이상의 beats라면 pause_space|bubble_space|borderless_scene|reaction_micro|transition_air 중 최소 2개 이상 포함. panel 3연속 금지. 비패널 구간 height_weight 합은 전체의 약 35% 이상 권장.",
        minItems: "2",
        maxItems: "6",
        items: {
          type: Type.OBJECT,
          properties: {
            kind: { type: Type.STRING, description: `연출 구간 종류: ${WEBTOON_SCROLL_BEAT_KIND_DOC}` },
            height_weight: { type: Type.NUMBER, description: "세로 길이 가중치 (1=짧음, 6=매우 김)" },
            visual_intent: { type: Type.STRING, description: "이 구간의 시각적 목적. 예: 긴 흰 여백으로 침묵 만들기" },
            text_intent: { type: Type.STRING, description: "말풍선/나레이션/텍스트 의도. 없으면 빈 문자열" },
            framing: { type: Type.STRING, description: `권장 프레이밍: ${WEBTOON_SCROLL_FRAMING_DOC}` },
            width_profile: { type: Type.STRING, description: `가로 폭 리듬: ${WEBTOON_SCROLL_WIDTH_PROFILE_DOC}. full만 반복하지 말고 medium/narrow/tiny를 섞으세요.` },
            x_position: { type: Type.STRING, description: `가로 위치: ${WEBTOON_SCROLL_X_POSITION_DOC}. center만 반복하지 말고 left/right/drift를 섞으세요.` },
            shape_style: { type: Type.STRING, description: `컷 형태: ${WEBTOON_SCROLL_SHAPE_STYLE_DOC}. borderless/diagonal/inset/overlap 중 하나 이상 권장.` },
            vertical_role: { type: Type.STRING, description: `스크롤 역할: ${WEBTOON_SCROLL_VERTICAL_ROLE_DOC}. pause/drop/reveal 중 하나 이상 포함.` },
            scroll_distance: { type: Type.STRING, description: `세로 호흡: ${WEBTOON_SCROLL_DISTANCE_DOC}. long/very_long 중 하나 이상 포함.` },
          },
          required: ["kind", "height_weight", "visual_intent"]
        }
      }
    },
    required: ["segment_index", "canvas_size", "segment_role", "choreography_pattern", "beats"]
  };

  const learningLayoutIntentSchema = {
    type: Type.OBJECT,
    properties: {
      role: { type: Type.STRING, description: `학습 레이아웃 역할: ${LEARNING_LAYOUT_ROLE_DOC}` },
      focus_panel_index: { type: Type.NUMBER, description: isLearningComicPro ? "가장 강조할 컷 번호 (선택한 템플릿 컷 수 안에서 1~7)" : "가장 강조할 컷 번호 (1~4)" },
      visual_flow: { type: Type.STRING, description: `페이지 안의 읽기 흐름: ${LEARNING_LAYOUT_FLOW_DOC}` },
      density: { type: Type.STRING, description: `정보 밀도: ${LEARNING_LAYOUT_DENSITY_DOC}` },
      template_reason: { type: Type.STRING, description: "선택한 template_id가 이 장면 흐름에 맞는 이유 1문장" },
    },
    required: ["role", "focus_panel_index", "visual_flow", "density", "template_reason"]
  };

  const pageSchema = {
    type: Type.OBJECT,
    properties: {
      chapter_title: { type: Type.STRING },
      template_id: {
        type: Type.STRING,
        ...(isDynamicLayout
          ? { description: `정적 웹툰 앵커 페이지일 때만 사용: ${webtoonAnchorTemplateSummaries.map((t) => t.id).join("|")}` }
          : {})
      },
      ...(isDynamicLayout ? { webtoon_layout: webtoonLayoutSchema } : {}),
      ...(isWebtoon ? { scroll_choreography: webtoonScrollChoreographySchema } : {}),
      ...(isLearningComicPro ? { learning_layout_intent: learningLayoutIntentSchema } : {}),
      panels: {
        type: Type.ARRAY,
        minItems: String(minPanels),
        maxItems: String(maxPanels),
        items: panelSchema
      }
    },
    required: isLearningComicPro ? ["chapter_title", "template_id", "panels", "learning_layout_intent"] : ["chapter_title", "panels"]
  };

  const buildPagesSchema = (count: number) => ({
    type: Type.ARRAY,
    minItems: String(count),
    maxItems: String(count),
    items: pageSchema
  });

  const outlineResponseSchema = (pageCount: number) => ({
    type: Type.OBJECT,
    properties: {
      series_title: { type: Type.STRING, description: "시리즈 제목" },
      core_insight: { type: Type.STRING, description: "핵심 로그라인 1문장" },
      rationale: { type: Type.STRING, description: "페이지 배분/구성 이유" },
      page_outlines: {
        type: Type.ARRAY,
        minItems: String(pageCount),
        maxItems: String(pageCount),
        items: {
          type: Type.OBJECT,
          properties: {
            page_number: { type: Type.NUMBER },
            sub_topic: { type: Type.STRING, description: "이 페이지의 장면/소제목" },
            content_summary: { type: Type.STRING, description: "이 페이지에서 다룰 장면 요약" },
            narrative_function: { type: Type.STRING, description: "introduction | deepening | turning_point | climax | resolution" },
            learning_action: { type: Type.STRING, description: "학습만화일 때 이 페이지가 담당하는 학습 행동 1개" },
            reader_question: { type: Type.STRING, description: "학습만화일 때 독자가 이 페이지에서 자연스럽게 품을 질문 1개" },
            opening_scene: { type: Type.STRING, description: "학습만화일 때 첫 컷에 보이는 구체적인 장면. 정의문/목표 선언 금지" },
            page_reveal: { type: Type.STRING, description: "학습만화일 때 페이지 끝의 작은 깨달음 1개" },
            dialogue_goal: { type: Type.STRING, description: "학습만화일 때 말풍선이 해야 할 역할" },
            page_speech_flow: { type: Type.STRING, description: "학습만화일 때 이 페이지의 말이 자연스럽게 이어지는 짧은 흐름" },
            dont_explain_yet: { type: Type.STRING, description: "학습만화일 때 아직 말하지 말아야 할 후반 정보. 없으면 빈 문자열" },
            allowed_content: { type: Type.ARRAY, items: { type: Type.STRING }, description: "학습만화일 때 이 페이지에서 실제로 설명해도 되는 정보" },
            forbidden_content: { type: Type.ARRAY, items: { type: Type.STRING }, description: "학습만화일 때 다음 페이지 이후로 넘겨야 해서 말하면 안 되는 정보" },
            next_page_tease: { type: Type.STRING, description: "학습만화일 때 다음 페이지로 넘기는 작은 궁금증" },
            density_note: { type: Type.STRING, description: "학습만화일 때 정보 밀도 점검 1문장" },
            connection_to_previous: { type: Type.STRING }
          },
          required: isLearningComic && !storyAntiEducationGuardEnabled
            ? ["page_number", "sub_topic", "content_summary", "narrative_function", "learning_action", "reader_question", "opening_scene", "page_reveal", "dialogue_goal", "page_speech_flow", "dont_explain_yet", "allowed_content", "forbidden_content", "next_page_tease", "density_note", "connection_to_previous"]
            : ["page_number", "sub_topic", "content_summary", "narrative_function", "connection_to_previous"]
        }
      }
    },
    required: ["series_title", "core_insight", "rationale", "page_outlines"]
  });

  const fullResponseSchema = (count: number) => ({
    type: Type.OBJECT,
    properties: {
      series_title: { type: Type.STRING },
      plan_meta: {
        type: Type.OBJECT,
        properties: {
          core_insight: { type: Type.STRING },
          rationale: { type: Type.STRING },
          beats: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING } } } }
        }
      },
      pages: buildPagesSchema(count)
    },
    required: ["pages", "series_title", "plan_meta"]
  });

  const pagesOnlyResponseSchema = (count: number) => ({
    type: Type.OBJECT,
    properties: { pages: buildPagesSchema(count) },
    required: ["pages"]
  });

  const toGroundingSources = (resp: { candidates?: any[] }): GroundingSource[] => {
    const chunks = resp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    return chunks.filter((c: any) => c.web).map((c: any) => ({ title: c.web!.title || "참고", uri: c.web!.uri }));
  };

  const mergeGroundingSources = (base: GroundingSource[], next: GroundingSource[]): GroundingSource[] => {
    const dedup = new Map<string, GroundingSource>();
    for (const item of base) dedup.set(item.uri, item);
    for (const item of next) dedup.set(item.uri, item);
    return Array.from(dedup.values());
  };

  const templateUsageCount = new Map<string, number>();
  const chosenTemplateHistory: string[] = [];
  const shouldDiversifyTemplates =
    !isDynamicLayout &&
    !isKlingI2V &&
    params.layout_variety !== "low" &&
    params.templates.length > 1;
  const recentTemplateWindow = params.layout_variety === "high" ? 4 : 2;

  const templateTierScore = (template: LayoutTemplate): number => {
    if (params.layout_variety === "high") {
      if (template.variety_tier === "high") return 3;
      if (template.variety_tier === "medium") return 2;
      return 1;
    }
    if (params.layout_variety === "medium") {
      if (template.variety_tier === "medium") return 3;
      if (template.variety_tier === "high") return 2;
      return 1;
    }
    return 1;
  };

  const pickDiversifiedTemplate = (preferred: LayoutTemplate): LayoutTemplate => {
    if (!shouldDiversifyTemplates) return preferred;

    const recentIds = new Set(chosenTemplateHistory.slice(-recentTemplateWindow));
    if (!recentIds.has(preferred.id)) return preferred;

    let candidates = params.templates.filter((t) => !recentIds.has(t.id));
    if (candidates.length === 0) {
      candidates = params.templates.filter((t) => t.id !== preferred.id);
    }
    if (candidates.length === 0) return preferred;

    candidates.sort((a, b) => {
      const tierDiff = templateTierScore(b) - templateTierScore(a);
      if (tierDiff !== 0) return tierDiff;
      const usageDiff = (templateUsageCount.get(a.id) || 0) - (templateUsageCount.get(b.id) || 0);
      if (usageDiff !== 0) return usageDiff;
      return a.id.localeCompare(b.id);
    });
    return candidates[0] || preferred;
  };

  const markTemplateUsage = (template: LayoutTemplate): LayoutTemplate => {
    chosenTemplateHistory.push(template.id);
    templateUsageCount.set(template.id, (templateUsageCount.get(template.id) || 0) + 1);
    return template;
  };

  let usedWebtoonStaticAnchorPages = 0;
  const webtoonPatternHistory: string[] = [];
  const webtoonPatternSelectionDebug: any[] = [];

  const normalizeWebtoonHybridPage = (rawPage: any, pageNumber: number) => {
    if (!isWebtoon) return rawPage;

    const next = rawPage && typeof rawPage === "object" ? { ...rawPage } : {};
    const explicitTemplateId = typeof next.template_id === "string" ? next.template_id.trim() : "";
    const hasDynamicLayout = Boolean(next.webtoon_layout && typeof next.webtoon_layout === "object");
    const isStaticAnchor = explicitTemplateId && isWebtoonStaticAnchorTemplateId(explicitTemplateId);

    if (isStaticAnchor && usedWebtoonStaticAnchorPages < MAX_WEBTOON_STATIC_ANCHOR_PAGES) {
      usedWebtoonStaticAnchorPages += 1;
      delete next.webtoon_layout;
      return next;
    }

    if (hasDynamicLayout) {
      delete next.template_id;
      return next;
    }

    if (isStaticAnchor && usedWebtoonStaticAnchorPages >= MAX_WEBTOON_STATIC_ANCHOR_PAGES) {
      delete next.template_id;
    }

    delete next.template_id;
    return next;
  };

  const mapPages = (rawPages: any[], startIndex: number): PageSpec[] => {
    return rawPages.map((rawPage: any, idx: number) => {
      const pageNumber = startIndex + idx;
      const p = normalizeWebtoonHybridPage(rawPage, pageNumber);
      let template: LayoutTemplate;
      let actualPanelCount: number;
      let dynamicLayoutForPage: PageSpec["layout"]["webtoon_layout"] | undefined;
      let scrollChoreographyForPage: PageSpec["layout"]["scroll_choreography"] | undefined;
      let learningLayoutIntentForPage: PageSpec["layout"]["learning_layout_intent"] | undefined;
      const narrativeFunction = getOutlineNarrativeFunction(outline, pageNumber);
      const explicitTemplateId = typeof p?.template_id === "string" ? p.template_id.trim() : "";
      const explicitTemplate = explicitTemplateId
        ? params.templates.find((t) => t.id === explicitTemplateId)
        : undefined;
      const safePanels = Array.isArray(p?.panels) ? p.panels : [];
      const generatedPanelCount = safePanels.length;

      if (isWebtoon && explicitTemplate) {
        template = markTemplateUsage(explicitTemplate);
        actualPanelCount = explicitTemplate.panels.length;
        webtoonPatternHistory.push(`static:${explicitTemplate.id}`);
      } else if (isDynamicLayout && p.webtoon_layout) {
        try {
          const { layout, debugEntry } = finalizeWebtoonDynamicLayout({
            rawLayout: p.webtoon_layout,
            pageNumber,
            totalPages: targetPageCount,
            previousPatterns: webtoonPatternHistory,
            narrativeFunction,
          });
          template = buildDynamicWebtoonTemplate(layout);
          actualPanelCount = layout.panel_count;
          dynamicLayoutForPage = layout;
          webtoonPatternHistory.push(layout.core_pattern);
          webtoonPatternSelectionDebug.push(debugEntry);
        } catch {
          const fallback = params.templates[0];
          template = fallback;
          actualPanelCount = panelsPerPage;
          if (isWebtoon) webtoonPatternHistory.push(`static:${fallback.id}`);
        }
      } else {
        const forcedTemplate = params.templates[0];
        learningLayoutIntentForPage = isLearningComicPro
          ? normalizeLearningLayoutIntent(p?.learning_layout_intent)
          : undefined;
        const recentTemplateIds = new Set(chosenTemplateHistory.slice(-recentTemplateWindow));
        const intentTemplate = isKlingI2V ? forcedTemplate
          : isLearningComicPro && learningLayoutIntentForPage
            ? pickLearningTemplateByIntent(
              learningLayoutIntentForPage,
              params.templates,
              explicitTemplate || forcedTemplate,
              recentTemplateIds
            )
            : explicitTemplate || forcedTemplate;
        const requestedTemplate = isLearningComicPro && generatedPanelCount > 0
          ? pickLearningTemplateByPanelCount(
            params.templates,
            intentTemplate,
            generatedPanelCount,
            learningLayoutIntentForPage,
            recentTemplateIds
          )
          : intentTemplate;
        template = markTemplateUsage(isLearningComicPro ? requestedTemplate : pickDiversifiedTemplate(requestedTemplate));
        actualPanelCount = isWebtoon || isLearningComicPro ? template.panels.length : panelsPerPage;
        if (isWebtoon) webtoonPatternHistory.push(`static:${template.id}`);
      }

      if (isWebtoon) {
        scrollChoreographyForPage = finalizeWebtoonScrollChoreography({
          rawChoreography: p.scroll_choreography,
          pageNumber,
          totalPages: targetPageCount,
          dynamicLayout: dynamicLayoutForPage,
          narrativeFunction,
        });
      }

      const outlineEntry = outline?.page_outlines.find((entry) => entry.page_number === pageNumber);
      const buildSupplementalPanel = (panelIndex: number, targetAspectRatio: string) => ({
        scene: params.language === "ko"
          ? `${pageNumber}페이지의 "${outlineEntry?.sub_topic || "흐름"}"을 이어 주는 조용한 관찰 컷. 앞선 컷을 반복하지 말고, 다른 표정, 손짓, 장소 단서, 물건 디테일을 보여준다.`
          : `A quiet continuation beat for page ${pageNumber}, showing a different expression, gesture, location clue, or object detail without repeating an earlier panel.`,
        acting: params.language === "ko"
          ? "인물이 앞선 대사를 반복하지 않고, 장면의 다른 단서를 바라보거나 반응한다."
          : "The character reacts to a different visual clue without repeating the previous line.",
        dialogues: [],
        camera: panelIndex === actualPanelCount - 1 ? "medium closing beat" : "small cutaway detail",
        mood: "quiet connective beat",
        target_aspect_ratio: targetAspectRatio
      });
      const normalizedPanels = Array.from({ length: actualPanelCount }, (_, pIdx) => {
        const templatePanelRatio = template.panels[pIdx]?.target_aspect_ratio || template.panels[0]?.target_aspect_ratio || i2vAspectRatio;
        const source = safePanels[pIdx] || buildSupplementalPanel(pIdx, templatePanelRatio);
        return {
          scene: String(source.scene || `Frame ${pIdx + 1}`),
          acting: String(source.acting || "Natural motion."),
          dialogues: Array.isArray(source.dialogues) ? source.dialogues.filter((d: unknown) => typeof d === "string") : [],
          camera: String(source.camera || "Eye-level"),
          mood: String(source.mood || "Neutral"),
          target_aspect_ratio: String(source.target_aspect_ratio || templatePanelRatio)
        };
      });
      return {
        page: { index: pageNumber, chapter_title: String(p?.chapter_title || `Page ${pageNumber}`) },
        layout: {
          template_id: template.id, canvas: template.canvas,
          gutter_px: isKlingI2V || isWebtoon ? 0 : isManga ? 6 : 12,
          border_px: isKlingI2V || isWebtoon ? 0 : isManga ? 3 : 4,
          border_radius_px: isKlingI2V || isWebtoon || isManga ? 0 : 16,
          background_color: "#FFFFFF",
          template_panels: template.panels,
          ...(learningLayoutIntentForPage ? { learning_layout_intent: learningLayoutIntentForPage } : {}),
          ...(dynamicLayoutForPage ? { webtoon_layout: dynamicLayoutForPage } : {}),
          ...(scrollChoreographyForPage ? { scroll_choreography: scrollChoreographyForPage } : {}),
          ...(isWebtoon ? { scroll: buildWebtoonScrollMeta({ template_id: template.id, webtoon_layout: dynamicLayoutForPage }, pageNumber, targetPageCount) } : {})
        },
        panels: normalizedPanels.map((pan, pIdx: number) => ({
          index: pIdx + 1, scene: pan.scene, acting: pan.acting,
          dialogues: pan.dialogues, camera: pan.camera, mood: pan.mood,
          render: { target_aspect_ratio: isKlingI2V ? i2vAspectRatio : pan.target_aspect_ratio, safe_area_hint: "Leave space at edges for dialogue" }
        }))
      };
    });
  };

  const requestPlanner = async (contents: string, responseSchema: any, schemaName: string) => {
    return await requestGeminiStructured({
      systemInstruction,
      contents,
      responseSchema,
      schemaName,
      reasoningEffort: geminiReasoningEffort,
      maxOutputTokens: getGeminiPlannerMaxOutputTokens(getGeminiMaxOutputTokens())
    });
  };

  const requestOutline = async (contents: string) => {
    return await requestGeminiStructured({
      systemInstruction,
      contents,
      responseSchema: outlineResponseSchema(targetPageCount),
      schemaName: "story_outline",
      reasoningEffort: geminiReasoningEffort,
      maxOutputTokens: 4096
    });
  };

  const debugChunks: PlannerDebugChunk[] = [];
  const maxPagesPerRequest = getGeminiMaxPagesPerRequest();
  const targetPageCount = Math.max(1, Math.floor(params.page_count));

  const deliveryReminder = params.delivery_style
    ? `\n말투/제스처 프리셋: ${params.delivery_style.preset_label}\n말투/제스처 지침: ${params.delivery_style.instruction}\n`
    : "";

  const inputTypeLabel = params.story_input_type === "script" ? "대본"
    : params.story_input_type === "prose" ? "소설/산문" : "시나리오";

  const basePrompt = `입력 형태: ${inputTypeLabel}
톤 모드: ${toneMode === "gag" ? `개그모드(${toneLevel})` : "일반모드"}
연령 등급: ${params.age_rating}
${genre ? `장르: ${genre}\n` : ""}페이싱: ${pacing}
분량: ${targetPageCount} 페이지.
디테일: ${params.detail_level}.
언어: ${params.language}.
${deliveryReminder}
${isKlingI2V ? `출력 모드: Kling I2V storyboard\n비율: ${i2vAspectRatio}\n` : ""}
아래 텍스트를 만화 패널 스크립트로 각색하세요.${storyAntiEducationGuardEnabled ? " 교육적 해설/강의 톤은 완전히 배제하고, 순수 비주얼 스토리텔링으로 변환하세요." : " 장면성과 감정 흐름이 살아 있는 비주얼 스토리텔링으로 변환하세요."}
${isKlingI2V ? "대사는 화자 포함 형식(\"화자: 대사\")으로 작성하세요." : "대사에서 화자 이름을 제거하고 순수 대사만 남기세요."}

[원본 텍스트]
${params.script_text}`;

  const formatOutlineForPrompt = (ol: PlanOutline): string => {
    const lines: string[] = [
      `\n\n[장면 분해 아웃라인 - 최우선 준수]`,
      `- 아래 아웃라인에 따라 각 페이지를 작성하세요.`,
      `- 학습 행동/독자 질문/첫 장면/작은 깨달음/대사 역할/말 흐름/허용 정보/금지 정보/다음 힌트/밀도 점검은 내부 제작 메모입니다. 해당 표현을 캐릭터 대사나 나레이션으로 직접 말하지 마세요.`,
      `- 허용 정보 안에서만 설명하고, 금지 정보는 대사/나레이션/화면 텍스트/장면 설명에 앞당겨 넣지 마세요.\n`
    ];
    for (const entry of ol.page_outlines) {
      lines.push(`[p${entry.page_number}] ${entry.sub_topic}`);
      lines.push(`  내용: ${entry.content_summary}`);
      lines.push(`  기능: ${entry.narrative_function}`);
      if (entry.learning_action) lines.push(`  학습 행동: ${entry.learning_action}`);
      if (entry.reader_question) lines.push(`  독자 질문: ${entry.reader_question}`);
      if (entry.opening_scene) lines.push(`  첫 장면: ${entry.opening_scene}`);
      if (entry.page_reveal) lines.push(`  작은 깨달음: ${entry.page_reveal}`);
      if (entry.dialogue_goal) lines.push(`  대사 역할: ${entry.dialogue_goal}`);
      if (entry.page_speech_flow) lines.push(`  말 흐름: ${entry.page_speech_flow}`);
      if (entry.dont_explain_yet) lines.push(`  아직 말하지 않기: ${entry.dont_explain_yet}`);
      if (Array.isArray(entry.allowed_content) && entry.allowed_content.length > 0) lines.push(`  허용 정보: ${entry.allowed_content.join(" / ")}`);
      if (Array.isArray(entry.forbidden_content) && entry.forbidden_content.length > 0) lines.push(`  금지 정보: ${entry.forbidden_content.join(" / ")}`);
      if (entry.next_page_tease) lines.push(`  다음 힌트: ${entry.next_page_tease}`);
      if (entry.density_note) lines.push(`  밀도 점검: ${entry.density_note}`);
      if (entry.connection_to_previous) lines.push(`  연결: ${entry.connection_to_previous}`);
    }
    return lines.join("\n");
  };

  const pageRangeHint = (startIndex: number, count: number, priorTitles: string[], outline?: PlanOutline | null) => {
    const endIndex = startIndex + count - 1;
    const prior = priorTitles.length > 0
      ? `\n\n[이미 작성된 페이지 제목(중복 금지)]\n- ${priorTitles.join("\n- ")}\n` : "";
    let rangeHint = "";
    if (outline) {
      const relevant = outline.page_outlines.filter(e => e.page_number >= startIndex && e.page_number <= endIndex);
      if (relevant.length > 0) {
        rangeHint = `\n\n[이번 범위 아웃라인 - 내부 제작 메모]\n`;
        rangeHint += `- 아래 학습 행동/질문/장면/밀도 점검 문구는 대사로 말하지 마세요. scene/acting/dialogues/camera에 자연스럽게 반영만 하세요.\n`;
        rangeHint += `- allowed_content 범위 안에서만 설명하세요. forbidden_content/아직 말하지 않기에 있는 정보가 dialogues, narration, screen text, scene 설명의 정보 내용으로 나오면 실패입니다.\n`;
        for (const e of relevant) {
          rangeHint += `- p${e.page_number}: ${e.sub_topic} → ${e.content_summary}`;
          if (e.learning_action) rangeHint += ` / 학습 행동: ${e.learning_action}`;
          if (e.reader_question) rangeHint += ` / 독자 질문: ${e.reader_question}`;
          if (e.opening_scene) rangeHint += ` / 첫 장면: ${e.opening_scene}`;
          if (e.page_reveal) rangeHint += ` / 작은 깨달음: ${e.page_reveal}`;
          if (e.dialogue_goal) rangeHint += ` / 대사 역할: ${e.dialogue_goal}`;
          if (e.page_speech_flow) rangeHint += ` / 말 흐름: ${e.page_speech_flow}`;
          if (e.dont_explain_yet) rangeHint += ` / 아직 말하지 않기: ${e.dont_explain_yet}`;
          if (Array.isArray(e.allowed_content) && e.allowed_content.length > 0) rangeHint += ` / 허용 정보: ${e.allowed_content.join(" | ")}`;
          if (Array.isArray(e.forbidden_content) && e.forbidden_content.length > 0) rangeHint += ` / 금지 정보: ${e.forbidden_content.join(" | ")}`;
          if (e.next_page_tease) rangeHint += ` / 다음 힌트: ${e.next_page_tease}`;
          if (e.density_note) rangeHint += ` / 밀도 점검: ${e.density_note}`;
          rangeHint += "\n";
        }
      }
    }
    return `\n\n[페이지 범위]
- 전체 ${targetPageCount}페이지 중 ${startIndex}~${endIndex}페이지를 작성하세요. (${count}페이지)
- pages 배열 길이: ${count}. 각 페이지 panels: ${isWebtoon ? "정적 앵커면 템플릿 컷 수, 동적이면 2~5개(webtoon_layout.panel_count와 일치)" : isDynamicLayout ? "2~5개 (webtoon_layout.panel_count와 일치)" : isLearningComicPro ? "선택한 template_id의 컷 수와 일치(3~7개)" : `${panelsPerPage}개`}.${prior}${rangeHint}`;
  };

  const runChunk = async (startIndex: number, count: number, priorTitles: string[], includePlanMeta: boolean, outlineContext: string, outline?: PlanOutline | null) => {
    const contents = `${basePrompt}${outlineContext}${pageRangeHint(startIndex, count, priorTitles, outline)}`;
    const schema = includePlanMeta ? fullResponseSchema(count) : pagesOnlyResponseSchema(count);
    const resp = await requestPlanner(contents, schema, includePlanMeta ? "story_full_plan" : "story_pages_only");
    const json = safeParseJson(resp.text);
    debugChunks.push({
      start_index: startIndex, end_index: startIndex + count - 1,
      include_plan_meta: includePlanMeta, enable_search: false,
      contents_with_research: contents, contents_without_research: contents,
      response_json: json
    });
    return { json, grounding_sources: resp.sources };
  };

  // ========== PASS 1: OUTLINE (prose/scenario with 2+ pages) ==========
  let outline: PlanOutline | null = null;
  let outlineSection = "";

  // For "script" input, skip outline if the user already structured the content
  const needsOutline = targetPageCount > 1 && params.story_input_type !== "script";

  if (needsOutline) {
    try {
      const outlinePrompt = `${basePrompt}

[아웃라인 작성 지시]
- 위 텍스트를 총 ${targetPageCount}페이지의 만화로 각색하기 위한 장면 분해 아웃라인을 작성하세요.
- 각 페이지마다: 장면 소제목(sub_topic), 내용 요약(1~2문장), 서사 기능(narrative_function), 이전 페이지 연결.
- 원본 텍스트의 핵심 장면/대사/감정 비트를 빠뜨리지 마세요.
${isLearningComic && !storyAntiEducationGuardEnabled ? `- 학습만화 포맷에서는 먼저 텍스트를 학습 행동 단위로 나누고, 페이지마다 learning_action 하나만 배정하세요.
- 각 페이지는 독자의 생각 한 걸음입니다. reader_question, opening_scene, page_reveal, dialogue_goal, dont_explain_yet을 구분하세요.
- page_speech_flow에는 이 페이지의 설명자 말을 이어 읽었을 때 자연스럽게 들리는 짧은 흐름을 쓰세요. 발표문처럼 쓰지 마세요.
- opening_scene은 실제로 그릴 수 있는 장면이어야 하며, "오늘은...", "○○란..." 같은 정의/목표 선언으로 시작하지 마세요.
- 한 페이지에 정의/뜻/사용상황/예문/주의점/요약이 3개 이상 몰리면 과밀입니다. density_note에 무엇을 줄였는지 적고 content_summary를 좁히세요.
- 페이지 수가 고정되어 있어도 한 페이지가 여러 역할을 떠안게 만들지 마세요.` : ""}
- 실제 대사나 scene/acting/camera는 작성하지 마세요.`;

      const outlineResp = await requestOutline(outlinePrompt);
      const outlineJson = safeParseJson(outlineResp.text);
      const rawOutlines = Array.isArray(outlineJson?.page_outlines) ? outlineJson.page_outlines : [];
      const asStringArray = (value: unknown): string[] =>
        Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
      const normalizedOutlines = Array.from({ length: targetPageCount }, (_, i) => {
        const entry = rawOutlines[i];
        return {
          page_number: i + 1,
          sub_topic: String(entry?.sub_topic || `Page ${i + 1}`),
          content_summary: String(entry?.content_summary || ""),
          narrative_function: String(entry?.narrative_function || "deepening"),
          learning_action: String(entry?.learning_action || ""),
          reader_question: String(entry?.reader_question || ""),
          opening_scene: String(entry?.opening_scene || ""),
          page_reveal: String(entry?.page_reveal || ""),
          dialogue_goal: String(entry?.dialogue_goal || ""),
          page_speech_flow: String(entry?.page_speech_flow || ""),
          dont_explain_yet: String(entry?.dont_explain_yet || ""),
          allowed_content: asStringArray(entry?.allowed_content),
          forbidden_content: asStringArray(entry?.forbidden_content),
          next_page_tease: String(entry?.next_page_tease || ""),
          density_note: String(entry?.density_note || ""),
          connection_to_previous: String(entry?.connection_to_previous || "")
        };
      });
      outline = {
        series_title: String(outlineJson?.series_title || "Story"),
        core_insight: String(outlineJson?.core_insight || ""),
        rationale: String(outlineJson?.rationale || ""),
        page_outlines: normalizedOutlines
      };
      outlineSection = formatOutlineForPrompt(outline);
      debugChunks.push({
        start_index: 0, end_index: 0,
        include_plan_meta: true, enable_search: false,
        contents_with_research: outlinePrompt, contents_without_research: outlinePrompt,
        response_json: outlineJson
      });
    } catch (err) {
      console.warn("Story outline generation failed, using 1-pass:", err);
      outline = null;
      outlineSection = "";
    }
  }

  // ========== PASS 2: PAGE SCRIPTS ==========
  const rawTitleHistory: string[] = [];
  const pages: PageSpec[] = [];
  let seriesTitle: string | null = outline?.series_title || null;
  let planMetaFromModel: any = null;
  let groundingSources: GroundingSource[] = [];

  let nextStartIndex = 1;
  while (pages.length < targetPageCount) {
    const remaining = targetPageCount - pages.length;
    let chunkSize = Math.min(remaining, maxPagesPerRequest);
    let lastError: any = null;
    while (chunkSize >= 1) {
      try {
        const needsPlanMeta = pages.length === 0 && !outline;
        const chunk = await runChunk(nextStartIndex, chunkSize, rawTitleHistory, needsPlanMeta, outlineSection, outline);
        groundingSources = mergeGroundingSources(groundingSources, chunk.grounding_sources);
        if (needsPlanMeta) {
          seriesTitle = typeof chunk.json?.series_title === "string" ? chunk.json.series_title : seriesTitle;
          planMetaFromModel = chunk.json?.plan_meta ?? null;
        }
        const rawPages = Array.isArray(chunk.json?.pages) ? chunk.json.pages : [];
        for (const p of rawPages) {
          const title = typeof p?.chapter_title === "string" ? p.chapter_title.trim() : "";
          if (title) rawTitleHistory.push(title);
        }
        pages.push(...mapPages(rawPages, nextStartIndex));
        nextStartIndex = pages.length + 1;
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (chunkSize === 1) break;
        chunkSize = Math.max(1, Math.floor(chunkSize / 2));
      }
    }
    if (lastError) throw lastError;
  }

  // ========== BUILD RESULT ==========
  const series_spec: SeriesSpec = {
    series: {
      title: seriesTitle || "Story",
      language: params.language,
      audience_level: params.age_rating === "all_ages" ? "kids" : params.age_rating === "teen" ? "teen" : "intermediate",
      age_rating: params.age_rating,
      page_count: pages.length
    },
    anchors: {
      protagonist: {
        appearance: params.character_description,
        role: params.character_role,
        reference_images: params.character_refs
      },
      product: params.product && Array.isArray(params.product.reference_images) && params.product.reference_images.filter(Boolean).length > 0
        ? { label: String(params.product.label || "").trim() || "Product", reference_images: params.product.reference_images.filter(Boolean) }
        : undefined,
      tone_mode: toneMode,
      tone_level: toneMode === "gag" ? toneLevel : undefined,
      cast: cast.length > 0 ? cast : undefined,
      supporting_cast: params.supporting_cast?.trim() || undefined,
      style: params.style,
      delivery: params.delivery_style
    },
    constraints: {
      comic_mode: "pure_cinematic",
      publication_format: publicationFormat,
      manga_color_mode: mangaColorMode,
      i2v_aspect_ratio: i2vAspectRatio,
      text_strategy: publicationFormat === "webtoon" ? "embed_in_image" : "blank_bubbles_then_overlay",
      layout_variety: params.layout_variety,
      image_size: params.image_size,
      character_consistency_mode: characterConsistencyMode,
      creation_type: "story",
      story_input_type: params.story_input_type,
      story_genre: genre,
      pacing: pacing,
      story_anti_education_guard: storyAntiEducationGuardEnabled
    }
  };

  const plan_meta = {
    recommended_page_count: pages.length,
    page_count_used: pages.length,
    total_panels: pages.reduce((sum, p) => sum + p.panels.length, 0),
    detail_level: params.detail_level === "brief" ? 0 : params.detail_level === "detailed" ? 2 : 1,
    rationale_short: `${(outline?.core_insight || planMetaFromModel?.core_insight) ? `[로그라인: ${outline?.core_insight || planMetaFromModel?.core_insight}] ` : ""}${outline?.rationale || planMetaFromModel?.rationale || "Story adaptation flow."}`,
    beats: outline
      ? outline.page_outlines.map((entry, idx) => ({ id: `beat-${idx + 1}`, title: entry.sub_topic, type: entry.learning_action || entry.narrative_function, weight: 1 }))
      : (planMetaFromModel?.beats || []),
    layout_variety: params.layout_variety,
    layout_history_used: pages.map(p => p.layout.template_id),
    grounding_sources: groundingSources
  };

  const debug: PlannerDebugInfo = {
    model: getGeminiPlannerModel(),
    max_output_tokens: getGeminiPlannerMaxOutputTokens(getGeminiMaxOutputTokens()),
    reasoning_effort: geminiReasoningEffort,
    created_at: startedAt,
    system_instruction: systemInstruction,
    outline: outline || undefined,
    chunks: debugChunks,
    ...(webtoonPatternSelectionDebug.length > 0 ? { webtoon_pattern_selection: webtoonPatternSelectionDebug } : {})
  };

  return { series_spec, pages, plan_meta, debug };
};

export const generatePaperPlan = async (params: {
  paper_brief: PaperBrief;
  detail_level: ScriptDetail;
  language: Language;
  audience_level: AudienceLevel;
  layout_variety: LayoutVariety;
  image_size: ImageSize;
  page_count: number;
  publication_format: PublicationFormat;
  manga_color_mode?: MangaColorMode;
  i2v_aspect_ratio?: I2VAspectRatio;
  tone_mode?: ToneMode;
  tone_level?: ToneLevel;
  character_consistency_mode?: CharacterConsistencyMode;
  character_description: string;
  character_role: NarrativeRole;
  character_refs: { main: string; pack: string[] };
  supporting_cast?: string;
  cast?: CharacterSpec[];
  style: SeriesSpec["anchors"]["style"];
  templates: LayoutTemplate[];
  gemini_reasoning_effort?: GeminiReasoningEffort;
}): Promise<SeriesPlan> => {
  const brief = params.paper_brief;
  const topic = String(brief.paper_title || "논문").trim() || "논문";
  const paperResearchNotes = buildPaperResearchPackNotes(brief);
  const pageCount = Math.max(2, params.page_count);

  const basePlan = await generatePlan({
    topic,
    question_type: "explain",
    comic_mode: "learning",
    output_mode: params.publication_format === "kling_i2v" ? "kling_i2v" : "comic",
    publication_format: params.publication_format,
    manga_color_mode: params.manga_color_mode,
    i2v_aspect_ratio: params.i2v_aspect_ratio,
    tone_mode: params.tone_mode || "normal",
    tone_level: params.tone_level || "medium",
    intro_style: "standard",
    detail_level: params.detail_level,
    language: params.language,
    audience_level: params.audience_level,
    layout_variety: params.layout_variety,
    image_size: params.image_size,
    page_count: pageCount,
    character_consistency_mode: params.character_consistency_mode,
    character_description: params.character_description,
    character_role: params.character_role,
    character_refs: params.character_refs,
    supporting_cast: params.supporting_cast,
    cast: params.cast,
    style: params.style,
    templates: params.templates,
    gemini_reasoning_effort: params.gemini_reasoning_effort,
    research: {
      mode: "user",
      pack: {
        notes: paperResearchNotes
      }
    }
  });

  return overwriteLastPageWithPaperSummary(basePlan, brief);
};
