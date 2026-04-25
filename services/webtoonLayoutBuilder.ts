import {
  LayoutTemplate,
  WEBTOON_CORE_PATTERNS,
  WEBTOON_GAP_PROFILES,
  WEBTOON_LAYOUT_MODIFIERS,
  WebtoonCorePattern,
  WebtoonDynamicLayout,
  WebtoonDynamicPanel,
  WebtoonGapProfile,
  WebtoonLayoutModifier,
  WebtoonSceneType,
} from "../types";
import { WEBTOON_DYNAMIC_CONSTRAINTS as C } from "./formatConfig";
import { findClosestAspectRatio } from "./aspectRatio";

const VALID_SCENE_TYPES: WebtoonSceneType[] = [
  "dialogue", "action", "emotional", "establishing", "transition", "impact", "closeup"
];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const asRectPanel = (panel: LayoutTemplate["panels"][number]) => panel.shape === "rect" ? panel.rect || null : null;

type LayoutBeat = {
  panelIndices: number[];
  heightWeight: number;
};

/**
 * AI 출력의 raw JSON → 안전한 WebtoonDynamicLayout으로 파싱 + 검증
 */
export function parseDynamicLayout(raw: any): WebtoonDynamicLayout {
  const panelCount = clamp(Math.round(Number(raw?.panel_count) || 3), C.minPanels, C.maxPanels);
  const rawPanels: any[] = Array.isArray(raw?.panel_heights) ? raw.panel_heights : [];

  const panels: WebtoonDynamicPanel[] = Array.from({ length: panelCount }, (_, i) => {
    const src = rawPanels[i];
    const sceneType = VALID_SCENE_TYPES.includes(src?.scene_type)
      ? (src.scene_type as WebtoonSceneType)
      : "dialogue";
    const weight = clamp(Math.round(Number(src?.height_weight) || C.sceneTypeDefaults[sceneType] || 2), C.minHeightWeight, C.maxHeightWeight);
    return { scene_type: sceneType, height_weight: weight };
  });

  const corePattern = WEBTOON_CORE_PATTERNS.includes(raw?.core_pattern)
    ? (raw.core_pattern as WebtoonCorePattern)
    : inferCorePattern(panels);

  const normalizedModifiers = (Array.isArray(raw?.modifiers) ? raw.modifiers : [])
    .filter((modifier: unknown): modifier is WebtoonLayoutModifier => WEBTOON_LAYOUT_MODIFIERS.includes(modifier as WebtoonLayoutModifier));
  const modifiers: WebtoonLayoutModifier[] = Array.from(new Set<WebtoonLayoutModifier>(normalizedModifiers)).slice(0, 2);

  const gapProfile = WEBTOON_GAP_PROFILES.includes(raw?.gap_profile)
    ? (raw.gap_profile as WebtoonGapProfile)
    : inferGapProfile(corePattern, modifiers);

  const focusPanelIndex = clamp(
    Math.round(Number(raw?.focus_panel_index) || inferFocusPanelIndex(panels, corePattern)),
    1,
    panelCount
  );

  return {
    panel_count: panelCount,
    panels,
    core_pattern: corePattern,
    modifiers,
    gap_profile: gapProfile,
    focus_panel_index: focusPanelIndex,
  };
}

/**
 * WebtoonDynamicLayout → LayoutTemplate (가상 템플릿) 빌드
 */
export function buildDynamicWebtoonTemplate(layout: WebtoonDynamicLayout): LayoutTemplate {
  const { panel_count } = layout;
  const beats = buildBeats(layout);
  const totalWeight = beats.reduce((sum, beat) => sum + beat.heightWeight, 0);
  // Dynamic webtoon pages are rendered as a single mobile-first 9:16 page.
  // We vary internal rhythm inside that page instead of stretching to arbitrary long strips.
  const canvasHeight = C.baseCanvasHeight;
  const focusBeatIndex = Math.max(0, beats.findIndex((beat) => beat.panelIndices.includes(layout.focus_panel_index)));
  const beatGaps = buildBeatGaps(beats.length, layout.gap_profile, layout.modifiers, focusBeatIndex, layout.core_pattern);
  const totalGapFraction = beatGaps.reduce((sum, gap) => sum + gap, 0);
  const availableFraction = 1.0 - C.topMargin - C.bottomMargin - totalGapFraction;
  let currentY = C.topMargin;
  const templatePanels: LayoutTemplate["panels"] = [];

  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const beat = beats[beatIndex];
    const beatHeight = (beat.heightWeight / totalWeight) * availableFraction;

    if (beat.panelIndices.length === 2) {
      templatePanels.push(...buildSplitBeatPanels(beat, currentY, beatHeight, canvasHeight, layout));
    } else {
      const panelIndex = beat.panelIndices[0];
      templatePanels.push(buildSingleBeatPanel(panelIndex, currentY, beatHeight, beatIndex, beats.length, canvasHeight, layout));
    }

    currentY += beatHeight + (beatGaps[beatIndex] || 0);
  }

  rebalanceConsecutiveWidePanels(templatePanels, layout);
  applyModifiers(templatePanels, layout);

  return {
    id: [
      "webtoon_dynamic",
      layout.core_pattern,
      `${panel_count}p`,
      ...layout.modifiers
    ].join("_"),
    label: `Dynamic Webtoon ${patternLabel(layout.core_pattern)}`,
    variety_tier: "high",
    canvas: { w: C.canvasWidth, h: canvasHeight },
    panels: templatePanels,
  };
}

/**
 * 렌더러 프롬프트용 동적 레이아웃 텍스트 설명 생성
 */
export function describeDynamicLayout(layout: WebtoonDynamicLayout): string {
  const totalWeight = layout.panels.reduce((s, p) => s + p.height_weight, 0);
  const panelDescs = layout.panels.map((p, i) => {
    const pct = Math.round((p.height_weight / totalWeight) * 100);
    const label = sceneTypeLabel(p.scene_type);
    return `Panel ${i + 1}: ${label} (~${pct}% height)`;
  });
  const modifierLine = layout.modifiers.length > 0
    ? `Modifiers: ${layout.modifiers.map(modifierLabel).join(", ")}. `
    : "";

  return (
    `A single tall mobile webtoon page with ${layout.panel_count} panels using the "${patternLabel(layout.core_pattern)}" core pattern. ` +
    `Primary focus panel: ${layout.focus_panel_index}. Gap profile: ${layout.gap_profile}. ` +
    panelDescs.join(". ") + ". " +
    modifierLine +
    `${patternDescription(layout.core_pattern)} ` +
    `IMPORTANT: Use visibly different panel sizes and pacing — short dialogue beats, wider rhythm changes, and larger action/impact moments when appropriate.`
  );
}

function inferCorePattern(panels: WebtoonDynamicPanel[]): WebtoonCorePattern {
  const firstScene = panels[0]?.scene_type;
  const actionCount = panels.filter((panel) => panel.scene_type === "action").length;
  const emotionalCount = panels.filter((panel) => panel.scene_type === "emotional").length;
  const transitionCount = panels.filter((panel) => panel.scene_type === "transition").length;
  const closeupCount = panels.filter((panel) => panel.scene_type === "closeup").length;
  const impactIndex = panels.findIndex((panel) => panel.scene_type === "impact");

  if (
    impactIndex === panels.length - 1 &&
    (transitionCount > 0 || closeupCount > 0 || emotionalCount > 0)
  ) {
    return "void_reveal";
  }
  if (impactIndex >= 0) return "impact_tail";
  if (
    firstScene === "establishing" &&
    panels.length <= 3 &&
    (panels[0]?.height_weight || 0) >= 4
  ) {
    return "vertical_panorama";
  }
  if (firstScene === "establishing" && actionCount > 0 && panels.length >= 3) {
    return "one_point_charge";
  }
  if (actionCount >= 2 && transitionCount >= 1 && panels.length >= 4) {
    return "motion_runway";
  }
  if (panels.length >= 4 && actionCount + emotionalCount + transitionCount >= 3) {
    return "continuity_chain";
  }
  if (firstScene === "establishing" && panels.length >= 3) return "hero_drop";
  if (transitionCount > 0) return "stair_step";
  if (closeupCount > 0) return "closeup_pulse";
  if (panels.length >= 4 && panels.some((panel) => panel.scene_type === "action" || panel.scene_type === "emotional")) {
    return "split_row";
  }
  if (panels.every((panel) => panel.scene_type === "dialogue" || panel.scene_type === "emotional")) return "closeup_pulse";
  return panels.length >= 4 ? "continuity_chain" : "stack_focus";
}

function inferGapProfile(corePattern: WebtoonCorePattern, modifiers: WebtoonLayoutModifier[]): WebtoonGapProfile {
  if (modifiers.includes("long_pause_gap")) return "dramatic";
  if (corePattern === "void_reveal") return "dramatic";
  if (corePattern === "impact_tail" || corePattern === "hero_drop" || corePattern === "vertical_panorama" || corePattern === "one_point_charge") return "breathing";
  if (corePattern === "closeup_pulse" || corePattern === "continuity_chain") return "tight";
  return "balanced";
}

function inferFocusPanelIndex(panels: WebtoonDynamicPanel[], corePattern: WebtoonCorePattern): number {
  const impactIndex = panels.findIndex((panel) => panel.scene_type === "impact");
  if (impactIndex >= 0) return impactIndex + 1;
  if (corePattern === "hero_drop") return 1;
  if (corePattern === "vertical_panorama") return 1;
  if (corePattern === "void_reveal") return panels.length;
  if (corePattern === "impact_tail") return panels.length;
  if (corePattern === "one_point_charge") return Math.max(1, Math.ceil(panels.length / 2));

  let bestIndex = 0;
  let bestWeight = -1;
  panels.forEach((panel, index) => {
    if (panel.height_weight >= bestWeight) {
      bestWeight = panel.height_weight;
      bestIndex = index;
    }
  });
  return bestIndex + 1;
}

function buildBeats(layout: WebtoonDynamicLayout): LayoutBeat[] {
  const beats: LayoutBeat[] = [];
  if (layout.core_pattern === "split_row" && layout.panel_count >= 3) {
    const splitStart = layout.panel_count >= 4 ? 1 : 0;
    for (let idx = 0; idx < layout.panel_count;) {
      if (idx === splitStart && idx + 1 < layout.panel_count) {
        const beatPanels = [idx + 1, idx + 2];
        const primaryWeight = Math.max(layout.panels[idx].height_weight, layout.panels[idx + 1].height_weight);
        const secondaryWeight = Math.min(layout.panels[idx].height_weight, layout.panels[idx + 1].height_weight);
        beats.push({
          panelIndices: beatPanels,
          // Split beats should stay compact so the strip keeps a strong vertical rhythm on mobile.
          heightWeight: primaryWeight + secondaryWeight * 0.28,
        });
        idx += 2;
      } else {
        beats.push({
          panelIndices: [idx + 1],
          heightWeight: layout.panels[idx].height_weight,
        });
        idx += 1;
      }
    }
    return beats;
  }

  return layout.panels.map((panel, index) => ({
    panelIndices: [index + 1],
    heightWeight: panel.height_weight,
  }));
}

function buildBeatGaps(
  beatCount: number,
  gapProfile: WebtoonGapProfile,
  modifiers: WebtoonLayoutModifier[],
  focusBeatIndex: number,
  corePattern: WebtoonCorePattern
): number[] {
  const gapMultiplier: Record<WebtoonGapProfile, number> = {
    tight: 0.9,
    balanced: 1.15,
    breathing: 1.55,
    dramatic: 2.15,
  };
  const baseGap = C.gapFraction * gapMultiplier[gapProfile];
  const gaps = Array.from({ length: Math.max(0, beatCount - 1) }, (_, index) => {
    const centerWeight = index === focusBeatIndex - 1 || index === focusBeatIndex ? 1.18 : 1;
    return baseGap * centerWeight;
  });
  if (modifiers.includes("long_pause_gap") && gaps.length > 0) {
    const targetGapIndex = Math.min(Math.max(focusBeatIndex, 0), gaps.length - 1);
    gaps[targetGapIndex] += baseGap * 1.9;
  }
  if (corePattern === "void_reveal" && gaps.length > 0) {
    const targetGapIndex = Math.max(0, gaps.length - 1);
    gaps[targetGapIndex] += baseGap * 2.6;
  }
  if (corePattern === "continuity_chain") {
    return gaps.map((gap, index) =>
      gap * (index === focusBeatIndex - 1 ? 0.92 : 0.76)
    );
  }
  if (corePattern === "motion_runway") {
    return gaps.map((gap, index) => gap * (0.9 + index * 0.14));
  }
  if (corePattern === "vertical_panorama" && gaps.length > 0) {
    gaps[0] += baseGap * 0.6;
  }
  if (corePattern === "one_point_charge" && gaps.length > 0) {
    const targetGapIndex = Math.min(Math.max(focusBeatIndex - 1, 0), gaps.length - 1);
    gaps[targetGapIndex] += baseGap * 0.5;
  }
  return gaps;
}

function buildSplitBeatPanels(
  beat: LayoutBeat,
  currentY: number,
  beatHeight: number,
  canvasHeight: number,
  layout: WebtoonDynamicLayout
): LayoutTemplate["panels"] {
  const [leftIndex, rightIndex] = beat.panelIndices;
  const dominantIndex = layout.focus_panel_index === leftIndex || layout.focus_panel_index === rightIndex
    ? layout.focus_panel_index
    : leftIndex;
  const dominantLeft = dominantIndex === leftIndex;
  const leftWidth = dominantLeft ? 0.48 : 0.36;
  const rightWidth = dominantLeft ? 0.36 : 0.48;
  const splitGap = 0.04;
  const totalWidth = leftWidth + rightWidth + splitGap;
  const startX = (1 - totalWidth) / 2;

  return [
    makeRectPanel(leftIndex, {
      x: startX,
      y: currentY,
      w: leftWidth,
      h: beatHeight,
    }, canvasHeight, {
      sceneType: layout.panels[leftIndex - 1]?.scene_type || "dialogue",
      isFocus: leftIndex === layout.focus_panel_index,
      isSplit: true,
      corePattern: layout.core_pattern,
    }),
    makeRectPanel(rightIndex, {
      x: startX + leftWidth + splitGap,
      y: currentY,
      w: rightWidth,
      h: beatHeight,
    }, canvasHeight, {
      sceneType: layout.panels[rightIndex - 1]?.scene_type || "dialogue",
      isFocus: rightIndex === layout.focus_panel_index,
      isSplit: true,
      corePattern: layout.core_pattern,
    })
  ];
}

function buildSingleBeatPanel(
  panelIndex: number,
  currentY: number,
  beatHeight: number,
  beatIndex: number,
  beatCount: number,
  canvasHeight: number,
  layout: WebtoonDynamicLayout
): LayoutTemplate["panels"][number] {
  const sceneType = layout.panels[panelIndex - 1]?.scene_type || "dialogue";
  const isFocus = panelIndex === layout.focus_panel_index;
  const rect = resolveSingleBeatRect(sceneType, isFocus, layout.core_pattern, beatIndex, beatCount, beatHeight);

  return makeRectPanel(panelIndex, { ...rect, y: currentY, h: beatHeight }, canvasHeight, {
    sceneType,
    isFocus,
    isSplit: false,
    corePattern: layout.core_pattern,
  });
}

function resolveSingleBeatRect(
  sceneType: WebtoonSceneType,
  isFocus: boolean,
  corePattern: WebtoonCorePattern,
  beatIndex: number,
  beatCount: number,
  beatHeight: number
) {
  const isFirstBeat = beatIndex === 0;
  const isLastBeat = beatIndex === beatCount - 1;
  const isTallBeat = beatHeight >= 0.24;
  const alternateLeft = beatIndex % 2 === 0;

  if (sceneType === "impact") {
    return { x: 0.0, w: 1.0 };
  }

  if (corePattern === "hero_drop") {
    if (isFirstBeat || isFocus) return { x: 0.02, w: 0.96 };
    if (sceneType === "closeup" || sceneType === "dialogue") return { x: 0.24, w: 0.52 };
    if (sceneType === "emotional") return { x: alternateLeft ? 0.12 : 0.22, w: 0.60 };
    return { x: alternateLeft ? 0.08 : 0.18, w: 0.68 };
  }

  if (corePattern === "stair_step") {
    if (sceneType === "transition") return { x: 0.32, w: 0.36 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: alternateLeft ? 0.14 : 0.30, w: 0.50 };
    if (sceneType === "emotional") return { x: alternateLeft ? 0.08 : 0.24, w: 0.58 };
    return { x: alternateLeft ? 0.04 : 0.22, w: isTallBeat ? 0.74 : 0.66 };
  }

  if (corePattern === "closeup_pulse") {
    if (sceneType === "closeup") return { x: 0.28, w: 0.44 };
    if (sceneType === "dialogue") return { x: beatIndex % 2 === 0 ? 0.18 : 0.26, w: beatIndex % 2 === 0 ? 0.58 : 0.48 };
    if (sceneType === "emotional") return { x: 0.18, w: 0.56 };
    return { x: 0.06, w: isFocus ? 0.88 : 0.78 };
  }

  if (corePattern === "impact_tail") {
    if (isLastBeat || isFocus) return { x: 0.0, w: 1.0 };
    if (sceneType === "transition") return { x: 0.34, w: 0.32 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: alternateLeft ? 0.20 : 0.28, w: 0.48 };
    return { x: alternateLeft ? 0.10 : 0.20, w: 0.62 };
  }

  if (corePattern === "split_row") {
    if (sceneType === "establishing" && isFirstBeat) return { x: 0.04, w: 0.92 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: alternateLeft ? 0.16 : 0.30, w: 0.50 };
    if (sceneType === "transition") return { x: 0.30, w: 0.38 };
    return { x: alternateLeft ? 0.08 : 0.20, w: isTallBeat ? 0.72 : 0.64 };
  }

  if (corePattern === "vertical_panorama") {
    if (isFirstBeat || (isFocus && beatCount <= 3)) return { x: 0.08, w: 0.84 };
    if (sceneType === "transition") return { x: 0.34, w: 0.28 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: alternateLeft ? 0.18 : 0.30, w: 0.40 };
    if (sceneType === "emotional") return { x: alternateLeft ? 0.18 : 0.26, w: 0.46 };
    return { x: alternateLeft ? 0.14 : 0.24, w: 0.54 };
  }

  if (corePattern === "void_reveal") {
    if (isLastBeat || isFocus) return { x: 0.06, w: 0.88 };
    if (beatIndex === beatCount - 2) return { x: 0.32, w: 0.34 };
    if (sceneType === "transition") return { x: 0.38, w: 0.24 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: 0.30, w: 0.40 };
    if (sceneType === "emotional") return { x: 0.24, w: 0.46 };
    return { x: 0.18, w: 0.58 };
  }

  if (corePattern === "continuity_chain") {
    if (sceneType === "establishing" && isFirstBeat) return { x: 0.12, w: 0.76 };
    if (isFocus && isLastBeat) return { x: 0.12, w: 0.70 };
    if (sceneType === "transition") return { x: alternateLeft ? 0.18 : 0.28, w: 0.44 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: alternateLeft ? 0.20 : 0.28, w: 0.46 };
    if (sceneType === "emotional") return { x: alternateLeft ? 0.16 : 0.24, w: 0.50 };
    if (sceneType === "action") return { x: alternateLeft ? 0.12 : 0.22, w: isTallBeat ? 0.64 : 0.58 };
    return { x: alternateLeft ? 0.14 : 0.22, w: 0.56 };
  }

  if (corePattern === "motion_runway") {
    const runwayX = clamp(0.06 + beatIndex * 0.06, 0.06, 0.28);
    if (isLastBeat || isFocus) return { x: clamp(runwayX - 0.04, 0.04, 0.18), w: 0.86 };
    if (sceneType === "transition") return { x: clamp(runwayX + 0.10, 0.18, 0.36), w: 0.34 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: clamp(runwayX + 0.06, 0.14, 0.34), w: 0.42 };
    if (sceneType === "emotional") return { x: clamp(runwayX + 0.04, 0.12, 0.30), w: 0.50 };
    return { x: runwayX, w: isTallBeat ? 0.72 : 0.64 };
  }

  if (corePattern === "one_point_charge") {
    if (isFocus) return { x: 0.10, w: 0.80 };
    if (sceneType === "establishing" && isFirstBeat) return { x: 0.12, w: 0.76 };
    if (sceneType === "transition") return { x: 0.30, w: 0.40 };
    if (sceneType === "dialogue" || sceneType === "closeup") return { x: 0.32, w: 0.36 };
    if (sceneType === "emotional") return { x: 0.24, w: 0.46 };
    if (sceneType === "action") return { x: 0.18, w: isTallBeat ? 0.60 : 0.56 };
    return { x: 0.22, w: 0.52 };
  }

  if (sceneType === "establishing" && isFirstBeat) return { x: 0.03, w: 0.94 };
  if (sceneType === "action") return { x: isFocus ? 0.06 : 0.12, w: isFocus ? 0.86 : 0.70 };
  if (sceneType === "dialogue") return { x: alternateLeft ? 0.18 : 0.28, w: 0.50 };
  if (sceneType === "closeup") return { x: 0.28, w: 0.44 };
  if (sceneType === "emotional") return { x: alternateLeft ? 0.14 : 0.24, w: 0.56 };
  if (sceneType === "transition") return { x: 0.34, w: 0.32 };

  return { x: isLastBeat ? 0.10 : 0.08, w: isTallBeat ? 0.78 : 0.70 };
}

function makeRectPanel(
  panelIndex: number,
  rect: { x: number; y: number; w: number; h: number },
  canvasHeight: number,
  options?: {
    sceneType?: WebtoonSceneType;
    isFocus?: boolean;
    isSplit?: boolean;
    corePattern?: WebtoonCorePattern;
  }
): LayoutTemplate["panels"][number] {
  const rawX = clamp(rect.x, -0.04, 0.9);
  const rawY = clamp(rect.y, 0, 0.96);
  const maxWidth = Math.max(0.22, 1.02 - rawX);
  const maxHeight = Math.max(0.08, 1.0 - rawY);
  const safeRect = {
    x: rawX,
    y: rawY,
    w: clamp(rect.w, 0.22, maxWidth),
    h: clamp(rect.h, 0.08, maxHeight),
  };
  return {
    panel_index: panelIndex,
    shape: "rect",
    rect: safeRect,
    z: 1,
    target_aspect_ratio: resolveWebtoonPanelAspectRatio(safeRect, canvasHeight, options),
  };
}

function resolveWebtoonPanelAspectRatio(
  rect: { x: number; y: number; w: number; h: number },
  canvasHeight: number,
  options?: {
    sceneType?: WebtoonSceneType;
    isFocus?: boolean;
    isSplit?: boolean;
    corePattern?: WebtoonCorePattern;
  }
): string {
  const sceneType = options?.sceneType || "dialogue";
  const isFocus = Boolean(options?.isFocus);
  const isSplit = Boolean(options?.isSplit);
  const corePattern = options?.corePattern;

  if (sceneType === "impact") return "9:16";
  if (corePattern === "vertical_panorama" && (sceneType === "establishing" || isFocus)) return "9:16";
  if (corePattern === "void_reveal" && isFocus) return rect.w >= 0.84 ? "9:16" : "4:5";
  if (corePattern === "motion_runway" && sceneType === "action") return isFocus ? "9:16" : "4:5";
  if (corePattern === "one_point_charge" && isFocus) return rect.w >= 0.76 ? "5:4" : "4:5";
  if (sceneType === "closeup") return rect.w <= 0.48 ? "3:4" : "4:5";
  if (sceneType === "emotional") return rect.w <= 0.62 || !isFocus ? "3:4" : "4:5";
  if (sceneType === "transition") return rect.w <= 0.38 ? "4:5" : "1:1";
  if (sceneType === "dialogue") return isSplit ? "4:5" : (rect.w <= 0.54 ? "3:4" : rect.w <= 0.68 ? "4:5" : "5:4");
  if (sceneType === "action") return isSplit ? "4:5" : (rect.w <= 0.70 ? "3:4" : "4:5");
  if (sceneType === "establishing") return rect.h >= 0.30 && rect.w >= 0.88 ? "5:4" : "4:5";

  return findClosestAspectRatio(rect.w * C.canvasWidth, rect.h * canvasHeight);
}

function rebalanceConsecutiveWidePanels(
  templatePanels: LayoutTemplate["panels"],
  layout: WebtoonDynamicLayout
) {
  const sortedPanels = [...templatePanels].sort((a, b) => {
    const aRect = asRectPanel(a);
    const bRect = asRectPanel(b);
    return (aRect?.y || 0) - (bRect?.y || 0);
  });

  let wideRun = 0;
  for (let index = 0; index < sortedPanels.length; index++) {
    const panel = sortedPanels[index];
    const rect = asRectPanel(panel);
    if (!rect) continue;

    const sceneType = layout.panels[panel.panel_index - 1]?.scene_type || "dialogue";
    const isFocus = panel.panel_index === layout.focus_panel_index;
    const countsAsWide = rect.w >= 0.82;
    wideRun = countsAsWide ? wideRun + 1 : 0;

    if (wideRun < 2 || isFocus || sceneType === "impact" || sceneType === "establishing") {
      continue;
    }

    const compactWidth = sceneType === "action" ? 0.72 : sceneType === "emotional" ? 0.58 : 0.50;
    panel.rect = {
      x: index % 2 === 0 ? 0.12 : 0.26,
      y: rect.y,
      w: compactWidth,
      h: rect.h,
    };
    wideRun = 0;
  }
}

function applyModifiers(templatePanels: LayoutTemplate["panels"], layout: WebtoonDynamicLayout) {
  if (layout.modifiers.length === 0) return;

  const focusPanel = templatePanels.find((panel) => panel.panel_index === layout.focus_panel_index);
  const insetCandidate = pickInsetCandidate(templatePanels, layout);
  const reactionCandidate = pickReactionCandidate(templatePanels, layout);

  for (const modifier of layout.modifiers) {
    if (modifier === "diagonal_cut") {
      const target = pickDiagonalTarget(templatePanels, layout);
      convertRectToDiagonal(target);
    } else if (modifier === "overlap_bleed") {
      expandForBleed(focusPanel);
    } else if (modifier === "inset_closeup") {
      convertToInset(insetCandidate, focusPanel);
    } else if (modifier === "micro_reaction") {
      compressReactionPanel(reactionCandidate);
    } else if (modifier === "borderless_open") {
      if (focusPanel) {
        focusPanel.decor = { ...(focusPanel.decor || {}), border_px: 0 };
      }
    }
  }
}

function pickInsetCandidate(
  templatePanels: LayoutTemplate["panels"],
  layout: WebtoonDynamicLayout
): LayoutTemplate["panels"][number] | undefined {
  const closeupIndex = layout.panels.findIndex((panel) => panel.scene_type === "closeup");
  if (closeupIndex >= 0) return templatePanels.find((panel) => panel.panel_index === closeupIndex + 1);
  return templatePanels.find((panel) => panel.panel_index !== layout.focus_panel_index);
}

function pickReactionCandidate(
  templatePanels: LayoutTemplate["panels"],
  layout: WebtoonDynamicLayout
): LayoutTemplate["panels"][number] | undefined {
  const reactionIndex = layout.panels.findIndex((panel) => panel.scene_type === "dialogue" || panel.scene_type === "closeup");
  if (reactionIndex >= 0) return templatePanels.find((panel) => panel.panel_index === reactionIndex + 1);
  return templatePanels.find((panel) => panel.panel_index !== layout.focus_panel_index);
}

function pickDiagonalTarget(
  templatePanels: LayoutTemplate["panels"],
  layout: WebtoonDynamicLayout
): LayoutTemplate["panels"][number] | undefined {
  const actionIndex = layout.panels.findIndex((panel) => panel.scene_type === "action" || panel.scene_type === "impact");
  if (actionIndex >= 0) return templatePanels.find((panel) => panel.panel_index === actionIndex + 1);
  return templatePanels.find((panel) => panel.panel_index === layout.focus_panel_index);
}

function expandForBleed(panel?: LayoutTemplate["panels"][number]) {
  const rect = panel ? asRectPanel(panel) : null;
  if (!panel || !rect) return;
  panel.rect = {
    x: clamp(rect.x - 0.03, -0.04, 1),
    y: clamp(rect.y - 0.01, 0, 1),
    w: clamp(rect.w + 0.06, 0.22, 1.08),
    h: clamp(rect.h + 0.02, 0.08, 0.92),
  };
  panel.z = 3;
}

function convertToInset(
  panel?: LayoutTemplate["panels"][number],
  focusPanel?: LayoutTemplate["panels"][number]
) {
  const rect = panel ? asRectPanel(panel) : null;
  if (!panel || !rect) return;
  const focusRect = focusPanel ? asRectPanel(focusPanel) : null;
  const insetWidth = clamp(Math.min(rect.w * 0.6, 0.38), 0.22, 0.38);
  const insetHeight = clamp(rect.h * 0.58, 0.12, 0.24);
  const baseX = focusRect ? focusRect.x + focusRect.w - insetWidth * 0.86 : rect.x + rect.w - insetWidth;
  const baseY = focusRect ? focusRect.y + focusRect.h - insetHeight * 0.82 : rect.y - insetHeight * 0.2;
  panel.rect = {
    x: clamp(baseX, 0.04, 0.74),
    y: clamp(baseY, C.topMargin, 0.88),
    w: insetWidth,
    h: insetHeight,
  };
  panel.z = 4;
  panel.decor = { ...(panel.decor || {}), shadow: true, border_px: 0 };
}

function compressReactionPanel(panel?: LayoutTemplate["panels"][number]) {
  const rect = panel ? asRectPanel(panel) : null;
  if (!panel || !rect) return;
  const compactWidth = clamp(Math.min(rect.w, 0.58), 0.3, 0.58);
  const compactHeight = clamp(rect.h * 0.72, 0.08, 0.22);
  panel.rect = {
    x: clamp(rect.x + (rect.w - compactWidth) / 2, 0, 0.7),
    y: clamp(rect.y + rect.h * 0.12, C.topMargin, 0.92),
    w: compactWidth,
    h: compactHeight,
  };
}

function convertRectToDiagonal(panel?: LayoutTemplate["panels"][number]) {
  const rect = panel ? asRectPanel(panel) : null;
  if (!panel || !rect) return;
  const skew = Math.min(rect.h * 0.18, 0.08);
  panel.shape = "poly";
  panel.poly = [
    [rect.x, rect.y + skew * 0.45],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h - skew * 0.45],
    [rect.x, rect.y + rect.h],
  ];
  delete panel.rect;
}

function patternLabel(pattern: WebtoonCorePattern): string {
  const labels: Record<WebtoonCorePattern, string> = {
    stack_focus: "Stack Focus",
    hero_drop: "Hero Drop",
    split_row: "Split Row",
    stair_step: "Stair Step",
    closeup_pulse: "Close-up Pulse",
    impact_tail: "Impact Tail",
    vertical_panorama: "Vertical Panorama",
    void_reveal: "Void Reveal",
    continuity_chain: "Continuity Chain",
    motion_runway: "Motion Runway",
    one_point_charge: "One-Point Charge",
  };
  return labels[pattern] || pattern;
}

function patternDescription(pattern: WebtoonCorePattern): string {
  const descriptions: Record<WebtoonCorePattern, string> = {
    stack_focus: "Use a clean mobile page flow that alternates one broader beat with narrower portrait reactions instead of flat repeated strips.",
    hero_drop: "Open with a dominant hero beat, then drop into tighter portrait/supporting beats for mobile pacing.",
    split_row: "Mix staggered single beats with one compact side-by-side row to break the vertical rhythm.",
    stair_step: "Offset panels left and right to create a staircase reading flow with asymmetric widths.",
    closeup_pulse: "Pulse between medium-wide beats and narrower centered close-ups to create emotional compression.",
    impact_tail: "Build tension with compact setup beats, white-space pauses, and finish on one oversized climax panel.",
    vertical_panorama: "Anchor the page with sustained vertical depth, then support it with inset beats that preserve a sense of height and scale.",
    void_reveal: "Use compact setup beats, a deliberate empty pause, and then a delayed reveal that lands after extra scroll distance.",
    continuity_chain: "Slice one event into several linked beats so time is felt through repeated, connected micro-moments.",
    motion_runway: "Align action beats with the downward scroll direction so the page feels like accelerating movement.",
    one_point_charge: "Center the composition around perspective pull and a single forward-driving charge into depth.",
  };
  return descriptions[pattern] || "";
}

function modifierLabel(modifier: WebtoonLayoutModifier): string {
  const labels: Record<WebtoonLayoutModifier, string> = {
    borderless_open: "borderless open panel",
    inset_closeup: "inset close-up",
    diagonal_cut: "diagonal cut",
    overlap_bleed: "overlap bleed",
    long_pause_gap: "long pause gap",
    micro_reaction: "micro reaction panel",
  };
  return labels[modifier] || modifier;
}

function sceneTypeLabel(st: WebtoonSceneType): string {
  const labels: Record<WebtoonSceneType, string> = {
    dialogue: "portrait-leaning dialogue beat",
    action: "tall action beat",
    emotional: "portrait emotional beat",
    establishing: "opening establishing beat",
    transition: "compact transition beat",
    impact: "oversized impact/splash beat",
    closeup: "narrow close-up beat",
  };
  return labels[st] || st;
}
