
import { Type } from "./schemaTypes";
import { SeriesSpec, PageSpec, Language, AudienceLevel, NarrativeRole, LayoutVariety, LayoutTemplate, ImageSize, GroundingSource, ResearchMode, ResearchPack, QuestionType, ScriptDetail, DeliveryStyleSpec, ComicMode, ToneMode, ToneLevel, IntroStyle, CharacterSpec, CharacterConsistencyMode, PlannerDebugChunk, PlannerDebugInfo, SeriesPlan, OutputMode, I2VAspectRatio, PlanOutline, PublicationFormat, MangaColorMode, StoryInputType, AgeRating, StoryGenre, PacingPreference, PaperBrief, GeminiReasoningEffort, WEBTOON_CORE_PATTERNS, WEBTOON_GAP_PROFILES, WEBTOON_LAYOUT_MODIFIERS, WEBTOON_SCROLL_BEAT_KINDS, WEBTOON_SCROLL_CHOREOGRAPHY_PATTERNS, WEBTOON_SCROLL_DISTANCES, WEBTOON_SCROLL_FRAMINGS, WEBTOON_SCROLL_SHAPE_STYLES, WEBTOON_SCROLL_VERTICAL_ROLES, WEBTOON_SCROLL_WIDTH_PROFILES, WEBTOON_SCROLL_X_POSITIONS, WebtoonCorePattern, WebtoonDynamicLayout, WebtoonScrollBeatKind, WebtoonScrollChoreography, WebtoonScrollChoreographyPattern, WebtoonScrollDistance, WebtoonScrollFraming, WebtoonScrollSegmentRole, WebtoonScrollShapeStyle, WebtoonScrollVerticalRole, WebtoonScrollWidthProfile, WebtoonScrollXPosition } from "../types";
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
  const lines: string[] = [
    "[PAPER MODE]",
    `- title: ${brief.paper_title}`,
    `- domain: ${brief.domain_guess}`,
    `- track: ${brief.paper_mode_track === "methodology_focus" ? "방법론 중심" : "대중형 요약"}`,
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
      ? "- 방법 설명이 중심이어도, 첫 페이지는 반드시 연구 배경과 기존 접근의 한계를 먼저 깔고 그 다음 방법 구조로 넘어가세요."
      : "- 기술 세부보다 왜 중요한지, 무엇이 새롭고 어떤 의미가 있는지 쉽게 설명하세요."
  );
  lines.push("- 첫 페이지는 논문의 주장/결과를 바로 선언하지 말고, 배경 상황이나 독자가 공감할 예시로 시작하세요.");
  lines.push("- 초반 1~2페이지 안에서 '기존 한계 -> 연구 질문 -> 핵심 아이디어' 순서를 분명하게 연결하세요.");
  lines.push("- reader_hook_example이 있으면 도입 컷에서 우선 활용하고, 없으면 motivation_context를 장면형 설명으로 풀어주세요.");
  lines.push("- public_summary는 첫 페이지를 배경/필요성 중심으로, methodology_focus는 첫 페이지를 문제 정의 후 두 번째 페이지부터 방법 중심으로 전개하세요.");
  lines.push("- 마지막 페이지는 논문 요약 페이지로 마무리해야 합니다.");
  lines.push("- 본문 컷에 claim/evidence/caveat 태그를 상시 노출하지 말고, 마지막 요약 페이지에만 정리하세요.");

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

  const summaryBlocks = (() => {
    if (panelCount <= 1) {
      return [{
        title: "논문 요약",
        scene: "A clean summary page that condenses the paper's claim, method, results, limitations, and source cues into one strong recap image.",
        dialogue: `[narration]${brief.one_line_takeaway || brief.paper_title}\n[narration]핵심 기여: ${contributionsJoined}\n[narration]방법/결과: ${brief.method_summary || brief.result_summary}\n[narration]한계: ${limitationLine}`
      }];
    }
    if (panelCount === 2) {
      return [
        {
          title: "핵심 요약",
          scene: "A recap panel that states the paper's problem and one-line takeaway with simple visual metaphors.",
          dialogue: `[narration]${brief.one_line_takeaway || brief.paper_title}\n[narration]문제: ${brief.core_problem || "기존 접근의 한계를 다룸"}`
        },
        {
          title: "기여와 한계",
          scene: "A structured recap panel that balances contributions, limitations, and source cues without hype.",
          dialogue: `[narration]기여: ${contributionsJoined}\n[narration]한계: ${limitationLine}\n[narration]${sourceLine}`
        }
      ];
    }
    if (panelCount === 3) {
      return [
        {
          title: "왜 중요한가",
          scene: "A recap panel that summarizes the paper's core problem and takeaway for the reader.",
          dialogue: `[narration]${brief.one_line_takeaway || brief.paper_title}\n[narration]문제: ${brief.core_problem || "핵심 문제 정의"}`
        },
        {
          title: "무엇을 했나",
          scene: "A summary panel showing the paper's method and the main contribution in a simplified explanatory composition.",
          dialogue: `[narration]기여: ${contributionsJoined}\n[narration]방법: ${brief.method_summary || "방법 요약 없음"}`
        },
        {
          title: "무엇을 남겼나",
          scene: "A closing recap panel that presents results, limitations, and source cues in a clear note-like composition.",
          dialogue: `[narration]결과: ${brief.result_summary || "결과 요약 없음"}\n[narration]한계: ${limitationLine}\n[narration]${sourceLine}`
        }
      ];
    }

    const blocks = [
      {
        title: "한 줄 요약",
        scene: "A compact recap panel stating the paper's one-line takeaway in a readable summary composition.",
        dialogue: `[narration]${brief.one_line_takeaway || brief.paper_title}`
      },
      {
        title: "핵심 문제",
        scene: "A summary panel describing the problem space or motivation behind the paper.",
        dialogue: `[narration]문제: ${brief.core_problem || "핵심 문제 정의"}`
      },
      {
        title: "핵심 기여",
        scene: "A recap panel that lists the paper's most important contributions without exaggeration.",
        dialogue: `[narration]기여: ${contributionsJoined}`
      },
      {
        title: "방법",
        scene: "A summary panel that explains the method at a high level using clean explanatory staging.",
        dialogue: `[narration]방법: ${brief.method_summary || "방법 요약 없음"}`
      },
      {
        title: "결과",
        scene: "A summary panel that presents the main result or evaluation takeaway in a restrained, factual tone.",
        dialogue: `[narration]결과: ${brief.result_summary || "결과 요약 없음"}`
      },
      {
        title: "한계와 출처",
        scene: "A closing note panel that acknowledges limitations and where the summary came from inside the paper.",
        dialogue: `[narration]한계: ${limitationLine}\n[narration]${sourceLine}`
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
  const isDynamicLayout = isWebtoon;
  const panelsPerPage = isKlingI2V ? 1 : isManga ? 6 : isWebtoon ? 3 : 4;
  const minPanels = isWebtoon ? 1 : isDynamicLayout ? 2 : panelsPerPage;
  const maxPanels = isDynamicLayout ? 5 : panelsPerPage;
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
- 구조: (오해/선입견) → (정의/경계) → (핵심 원리/예시) → (요약/체크 + 오해 정리).`
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
  - 첫 컷은 '정의/상황/목표'로 바로 시작하세요. (예: "현재진행형은 지금 ~하는 중이에요.")
- 도입/초반(1~2컷)에서 반박형 프레이밍을 쓰지 마세요.
- 특히 아래 표현은 도입/초반(1~2컷)에서 금지:
    - "단순히 ~가 아니라", "단순한 ~가 아니라", "그것은 단순한 ~가 아니라, ~다", "A가 아니라 B", "많이들 ~라고 생각하지만", "사실은", "오해/착각"
- 오해/과장된 프레이밍 교정은 '필요할 때만' 중후반에 짧게 하세요. (해당 주제에 흔한 오해가 있거나 사용자가 요청한 경우)
- 기본 흐름: 정의/경계(무엇이 아닌지) → 핵심 원리 → 대표 예시/비유 → (선택) 흔한 오해 0~2개 → 안전한 요약(조건/주의 포함).`;
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
- 정의/경계와 핵심 원리 위주로 구성하고, 예시는 최소화하세요.
- 불필요한 수식/반복을 피하세요.`
      : params.detail_level === "detailed"
        ? introStyle === "myth_busting" && !isAnyCinematic && params.question_type === "explain"
          ? `

[디테일 레벨: DETAILED / 오해 깨기]
- 각 패널의 dialogues는 3~5줄까지 허용하되, 과밀하게 느껴지지 않게 짧게 끊어 쓰세요.
- 흔한 오해 1~2개를 myth→fact로 자연스럽게 교정하세요. (도입 훅 + 마무리 정리)
- 마지막에 복습(체크포인트)을 넣으세요.
- 단, 리서치 근거가 없는 단정은 금지(추가 리서치 필요 처리).`
          : `

[디테일 레벨: DETAILED]
- 각 패널의 dialogues는 3~5줄까지 허용하되, 과밀하게 느껴지지 않게 짧게 끊어 쓰세요.
- 예시/비유를 포함하고, 필요할 때만 흔한 오해 0~2개를 교정하세요.
- 마지막에 복습(체크포인트)을 넣으세요.
- 단, 리서치 근거가 없는 단정은 금지(추가 리서치 필요 처리).`
        : `

[디테일 레벨: NORMAL]
- 각 패널의 dialogues는 2~3줄 중심으로 균형 있게 쓰세요.
- 정의/경계 → 핵심 원리 → 예시/비유 → 안전한 요약 흐름을 유지하세요.
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
- 컷당 dialogues는 2~4줄까지 허용하되, 리듬이 끊기지 않게 짧게 끊어 쓰세요.
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
- 대사 규칙: 말풍선 1개 = 한 문장(한 번에 한 가지). 길게 설명하지 말고 짧게 끊어 쓰세요.
- 용어 규칙: 어려운 용어/약어/영어를 최대한 쓰지 마세요. 꼭 필요하면 같은 말풍선 안에서 1줄로 뜻을 풀어쓰세요.
- 설명 흐름: "정의 1줄 → 아주 쉬운 예(학교/놀이/간식/장난감) → 한 줄 복습" 순서를 유지하세요.
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
- 전문 용어는 최소화하고, 필요하면 '정의→예시'로 짧게 설명하세요.
- 핵심 메커니즘을 비유로 잡아주되, 비유의 한계(어디까지 맞는지)를 한 번 짚어주세요.`
          : params.audience_level === "expert"
            ? `

[독자 수준: 전문가(Expert) - 매우 중요]
- 지나친 단순화는 피하세요. 정확한 용어/경계를 사용하고, 핵심 트레이드오프/전제/한계를 명시하세요.
- 다만 컷당 텍스트 과밀은 금지이므로, 문장은 짧게 끊고 핵심만 남기세요.`
            : `

[독자 수준: 준전문(Intermediate) - 매우 중요]
- 정확도를 유지하되, 핵심 용어는 짧게 정의하고 단계적으로 쌓아가세요.
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

  const debugChunks: PlannerDebugChunk[] = [];

  const researchInstruction = usingProvidedResearch
    ? `

[사용자 제공 리서치 팩 - 최우선]
- 아래 리서치 팩에 포함된 정보만 사용하세요. 모르는 내용은 추측하지 말고 "UNKNOWN"으로 표시하세요.
- 리서치 팩에 근거가 없는 주장/수치/인명/연도/원인-결과 관계를 임의로 만들지 마세요.
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
1. 한 페이지(4컷)마다 '한 가지'만 가르치세요.
2. 4컷 구조: 도입(오늘 배울 것 1줄) → 예시(학교/놀이로) → 왜?(이유 1문장) → 복습(한 줄 정리 + 아주 쉬운 질문 1개).
3. 추상적인 말 대신, 눈에 보이는 상황/행동/물건으로 설명하세요.`
    : `

[시나리오 철학: The Deep-Dive Framework]
1. 겉모습이 아닌 '영혼'을 설명하세요.
2. 강력한 비유(Deep Analogy)를 사용하세요.
3. 질문을 통해 본질적 원리로 해답을 제시하세요.
4. 패널당 4컷의 구조(도입-핵심원리-비유/실험-통찰)를 따르세요.`;

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
- core_insight: 1문장. 정의/핵심 요점만, 긍정문으로 작성하세요.
  - 형식 추천: "<주제>는 ...이다", "<주제>란 ...를 뜻한다"
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
- dialogues는 한국어 만화, 학습만화, 웹툰 말풍선에 바로 들어갈 자연스러운 한국어 구어체로 작성하세요.
- 좋은 대사는 "정보를 설명하는 문장"보다 "인물이 지금 상황에서 실제로 할 법한 말"입니다.
- 한 줄은 8~22자 안팎을 기본으로 하고, 길어지면 두 말풍선으로 나누세요.
- 장면의 감정, 관계, 반응이 말투에 묻어나게 쓰세요. 놀람은 짧게, 확신은 단단하게, 설명은 대화 속에서 가볍게.
- 입말 리듬을 살리세요: "이거 봐.", "잠깐, 여기야.", "아, 그래서 그런 거구나.", "그럼 이렇게 해보자."처럼 짧고 자연스러운 문장을 우선하세요.
- 학습 정보가 필요할 때도 교과서 문장보다 캐릭터가 이해하고 반응하는 말로 풀어주세요.
- plan_meta/rationale/scene/camera는 설명적으로 써도 되지만, dialogues만큼은 말풍선용 구어체를 유지하세요.`
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
      : `- 자연스러운 긍정문으로 바로 말하세요. "핵심은 이거야.", "이렇게 보면 쉬워.", "여기서 차이가 나."처럼 짧고 선명한 한국어 입말을 우선하세요.`;

  const dialogueFormatExample = isKlingI2V
    ? `- 예: "주인공: 준비됐어?" (O), "친구: 지금 가자!" (O)`
    : params.language === "ko"
      ? `- 좋은 예: "잠깐, 여기 봐." / "아, 이제 알겠다." / "그럼 순서가 바뀐 거네." / "좋아, 이걸로 가자."
- 피할 예: "그것은 단순한 A가 아니라 B입니다." / "핵심 원리는 다음과 같습니다." / "따라서 우리는 알 수 있습니다."
- 형식 예: "주인공: 안녕하세요" (X) -> "안녕하세요" (O)`
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

${frameworkInstruction}

[형식 규정]
${isDynamicLayout
    ? `- 웹툰 페이지는 기본적으로 동적 레이아웃을 사용하되, 전체에서 최대 2페이지만 정적 앵커 템플릿을 허용하세요.
- 동적 페이지: 2~5개의 패널을 생성하고 webtoon_layout(panel_count, panel_heights, core_pattern, modifiers, gap_profile, focus_panel_index)를 포함하세요.
- 정적 앵커 페이지: template_id를 사용하고, panels 배열 길이를 해당 템플릿 컷 수에 맞추세요.
- modifiers는 보통 0~1개, 중요한 페이지도 최대 2개까지만 사용하세요.
- 특별한 이유가 없다면 template_id 없이 webtoon_layout만 사용하세요.
- 대화/리액션/클로즈업은 좁은 portrait-leaning 컷을 자주 사용하고, 전폭 가로 패널의 연속 반복을 피하세요.${webtoonAnchorGuidance}`
    : `- 페이지당 정확히 ${panelsPerPage}개의 패널을 생성하세요.`}
- 언어: ${params.language}.
${languageInstruction}
${isDynamicLayout ? `- 레이아웃: 다이나믹 (핵심 패턴 + modifier 조합으로 페이지 리듬을 설계)` : `- 가용 템플릿: ${JSON.stringify(templateSummaries)}`}${castInstruction}${supportingCastInstruction}${characterConsistencyInstruction}${effectiveResearchInstruction}${effectiveDetailInstruction}${effectiveAudienceInstruction}${deliveryInstruction}`;

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

  const maxPagesPerRequest = getGeminiMaxPagesPerRequest();
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
      panels: {
        type: Type.ARRAY,
        minItems: String(minPanels),
        maxItems: String(maxPanels),
        items: panelSchema
      }
    },
    required: ["chapter_title", "panels"]
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
            connection_to_previous: { type: Type.STRING, description: "이전 페이지와의 연결 (1페이지는 빈 문자열)" }
          },
          required: ["page_number", "sub_topic", "content_summary", "narrative_function", "connection_to_previous"]
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
        rangeOutlineReminder = `\n\n[이번 범위에서 작성할 페이지 아웃라인 요약]\n`;
        for (const e of relevantEntries) {
          rangeOutlineReminder += `- p${e.page_number}: ${e.sub_topic} → ${e.content_summary}\n`;
        }
      }
    }
    return `\n\n[페이지 범위 - 매우 중요]
- 전체 분량은 총 ${targetPageCount}페이지입니다.
- 이번 응답에서는 ${startIndex}~${endIndex}페이지에 해당하는 내용만 작성하세요. (총 ${count}페이지)
- pages 배열 길이는 반드시 ${count}여야 합니다.
- 각 페이지는 panels가 ${isWebtoon ? "정적 앵커면 템플릿 컷 수, 동적이면 2~5개(webtoon_layout.panel_count와 일치)" : isDynamicLayout ? "2~5개 (webtoon_layout.panel_count와 일치)" : `반드시 ${panelsPerPage}개`}여야 합니다.${prior}${rangeOutlineReminder}`;
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
- 이것은 아웃라인입니다. 실제 대사(dialogues)나 scene/acting/camera를 작성하지 마세요.`;
  };

  const formatOutlineForPrompt = (ol: PlanOutline): string => {
    const lines: string[] = [
      `\n\n[전체 페이지 아웃라인 - 최우선 준수]`,
      `- 아래 아웃라인에 따라 각 페이지를 작성하세요.`,
      `- 각 페이지는 해당 page_number의 소주제와 내용 요약만 다루세요.`,
      `- 다른 페이지에 배정된 내용을 중복해서 다루지 마세요.\n`
    ];
    for (const entry of ol.page_outlines) {
      lines.push(`[p${entry.page_number}] ${entry.sub_topic}`);
      lines.push(`  내용: ${entry.content_summary}`);
      lines.push(`  기능: ${entry.narrative_function}`);
      if (entry.connection_to_previous) {
        lines.push(`  연결: ${entry.connection_to_previous}`);
      }
    }
    return lines.join("\n");
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
      const narrativeFunction = getOutlineNarrativeFunction(outline, pageNumber);
      const explicitTemplateId = typeof p?.template_id === "string" ? p.template_id.trim() : "";
      const explicitTemplate = explicitTemplateId
        ? params.templates.find((t) => t.id === explicitTemplateId)
        : undefined;

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
        const requestedTemplate = isKlingI2V
          ? forcedTemplate
          : explicitTemplate || forcedTemplate;
        template = markTemplateUsage(pickDiversifiedTemplate(requestedTemplate));
        actualPanelCount = isWebtoon ? template.panels.length : panelsPerPage;
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

      const safePanels = Array.isArray(p?.panels) ? p.panels : [];
      const normalizedPanels = Array.from({ length: actualPanelCount }, (_, pIdx) => {
        const source = safePanels[pIdx] || safePanels[0] || {};
        const templatePanelRatio =
          template.panels[pIdx]?.target_aspect_ratio ||
          template.panels[0]?.target_aspect_ratio ||
          i2vAspectRatio;
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
    const baseContents = `${prompt}${outlineContext}${pageRangeHint(startIndex, count, priorTitles, outline)}`;
    const contentsWithoutResearch = baseContents;
    const contentsWithResearch = `${baseContents}${researchContext}`;
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
      const normalizedOutlines = Array.from({ length: targetPageCount }, (_, i) => {
        const entry = rawOutlines[i];
        return {
          page_number: i + 1,
          sub_topic: String(entry?.sub_topic || `Page ${i + 1}`),
          content_summary: String(entry?.content_summary || ""),
          narrative_function: String(entry?.narrative_function || "deepening"),
          connection_to_previous: String(entry?.connection_to_previous || "")
        };
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
      : "한 줄 정의";
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
          type: entry.narrative_function,
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
    ratios: t.panels.map(p => p.target_aspect_ratio)
  }));
  const webtoonAnchorTemplateSummaries = getWebtoonAnchorTemplateSummaries(params.templates);

  const publicationFormat: PublicationFormat = params.publication_format;
  const mangaColorMode: MangaColorMode = params.manga_color_mode || "bw";
  const isKlingI2V = publicationFormat === "kling_i2v";
  const isWebtoon = publicationFormat === "webtoon";
  const isManga = publicationFormat === "manga";
  const isDynamicLayout = isWebtoon;
  const panelsPerPage = isKlingI2V ? 1 : isManga ? 6 : isWebtoon ? 3 : 4;
  const minPanels = isWebtoon ? 1 : isDynamicLayout ? 2 : panelsPerPage;
  const maxPanels = isDynamicLayout ? 5 : panelsPerPage;
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
    return `
[포맷: 만화 (4컷)]
- 페이지당 ${panelsPerPage}컷.
- 기승전결 구조로 한 페이지에 서사 단위를 완결하세요.`;
  })();

  // ── Detail level ──
  const detailInstruction = params.detail_level === "brief" ? `
[디테일: BRIEF]
- 대사는 0~2줄로 간결하게. scene/acting은 구체적으로.` : params.detail_level === "detailed" ? `
[디테일: DETAILED]
- 대사는 2~4줄까지 허용. 캐릭터성 있는 구어체로 짧게 끊어 쓰세요.
- scene/acting에 카메라 렌즈감, 동선 블로킹, 리액션 비트를 명시.` : `
[디테일: NORMAL]
- 대사는 1~3줄 중심. 감정선에 맞춰 군더더기 없이 쓰세요.`;

  // ── Language ──
  const languageInstruction = params.language === "en" ? `
[언어: 영어]
- 모든 출력 텍스트는 자연스러운 영어로 작성. 한국어 금지.` : `
[언어: 한국어]
- 모든 출력 텍스트는 자연스러운 한국어로 작성. 불필요한 영어 남발 금지.`;

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
${detailInstruction}
${languageInstruction}

[텍스트 규정]
${dialogueRule}
- 번역투/설명투 문장 금지. 인물의 목표/감정/관계를 드러내는 짧은 구어체로 작성.

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
    : `- 페이지당 정확히 ${panelsPerPage}개의 패널을 생성하세요.
- 가용 템플릿: ${JSON.stringify(templateSummaries)}`}`;

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
      panels: {
        type: Type.ARRAY,
        minItems: String(minPanels),
        maxItems: String(maxPanels),
        items: panelSchema
      }
    },
    required: ["chapter_title", "panels"]
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
            connection_to_previous: { type: Type.STRING }
          },
          required: ["page_number", "sub_topic", "content_summary", "narrative_function", "connection_to_previous"]
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
      const narrativeFunction = getOutlineNarrativeFunction(outline, pageNumber);
      const explicitTemplateId = typeof p?.template_id === "string" ? p.template_id.trim() : "";
      const explicitTemplate = explicitTemplateId
        ? params.templates.find((t) => t.id === explicitTemplateId)
        : undefined;

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
        const requestedTemplate = isKlingI2V ? forcedTemplate
          : explicitTemplate || forcedTemplate;
        template = markTemplateUsage(pickDiversifiedTemplate(requestedTemplate));
        actualPanelCount = isWebtoon ? template.panels.length : panelsPerPage;
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

      const safePanels = Array.isArray(p?.panels) ? p.panels : [];
      const normalizedPanels = Array.from({ length: actualPanelCount }, (_, pIdx) => {
        const source = safePanels[pIdx] || safePanels[0] || {};
        const templatePanelRatio = template.panels[pIdx]?.target_aspect_ratio || template.panels[0]?.target_aspect_ratio || i2vAspectRatio;
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
      `- 아래 아웃라인에 따라 각 페이지를 작성하세요.\n`
    ];
    for (const entry of ol.page_outlines) {
      lines.push(`[p${entry.page_number}] ${entry.sub_topic}`);
      lines.push(`  내용: ${entry.content_summary}`);
      lines.push(`  기능: ${entry.narrative_function}`);
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
        rangeHint = `\n\n[이번 범위 아웃라인]\n`;
        for (const e of relevant) rangeHint += `- p${e.page_number}: ${e.sub_topic} → ${e.content_summary}\n`;
      }
    }
    return `\n\n[페이지 범위]
- 전체 ${targetPageCount}페이지 중 ${startIndex}~${endIndex}페이지를 작성하세요. (${count}페이지)
- pages 배열 길이: ${count}. 각 페이지 panels: ${isWebtoon ? "정적 앵커면 템플릿 컷 수, 동적이면 2~5개(webtoon_layout.panel_count와 일치)" : isDynamicLayout ? "2~5개 (webtoon_layout.panel_count와 일치)" : `${panelsPerPage}개`}.${prior}${rangeHint}`;
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
- 실제 대사나 scene/acting/camera는 작성하지 마세요.`;

      const outlineResp = await requestOutline(outlinePrompt);
      const outlineJson = safeParseJson(outlineResp.text);
      const rawOutlines = Array.isArray(outlineJson?.page_outlines) ? outlineJson.page_outlines : [];
      const normalizedOutlines = Array.from({ length: targetPageCount }, (_, i) => {
        const entry = rawOutlines[i];
        return {
          page_number: i + 1,
          sub_topic: String(entry?.sub_topic || `Page ${i + 1}`),
          content_summary: String(entry?.content_summary || ""),
          narrative_function: String(entry?.narrative_function || "deepening"),
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
      ? outline.page_outlines.map((entry, idx) => ({ id: `beat-${idx + 1}`, title: entry.sub_topic, type: entry.narrative_function, weight: 1 }))
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
    tone_mode: "normal",
    tone_level: "medium",
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
