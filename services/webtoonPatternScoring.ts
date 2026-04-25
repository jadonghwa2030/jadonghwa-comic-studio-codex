import {
  WEBTOON_CORE_PATTERNS,
  WebtoonCorePattern,
  WebtoonDynamicPanel,
  WebtoonGapProfile,
  WebtoonLayoutModifier,
  WebtoonScrollSegmentRole,
  WebtoonSceneType,
} from "../types";

export type WebtoonIntentTag =
  | "intro_entry"
  | "scale_space"
  | "dialogue_exchange"
  | "emotional_focus"
  | "movement_transition"
  | "continuous_action"
  | "reveal_delay"
  | "climax_payoff";

export type IntentScoreMap = Record<WebtoonIntentTag, number>;

export type PatternScoreBreakdown = {
  pattern: WebtoonCorePattern;
  baseFit: number;
  historyAdjustment: number;
  gateAdjustment: number;
  finalScore: number;
  reasons: string[];
};

const INTENT_TAGS: WebtoonIntentTag[] = [
  "intro_entry",
  "scale_space",
  "dialogue_exchange",
  "emotional_focus",
  "movement_transition",
  "continuous_action",
  "reveal_delay",
  "climax_payoff",
];

const PATTERN_AFFINITY: Record<WebtoonCorePattern, Record<WebtoonIntentTag, number>> = {
  stack_focus: {
    intro_entry: 3,
    scale_space: 2,
    dialogue_exchange: 4,
    emotional_focus: 3,
    movement_transition: 2,
    continuous_action: 2,
    reveal_delay: 2,
    climax_payoff: 2,
  },
  hero_drop: {
    intro_entry: 5,
    scale_space: 4,
    dialogue_exchange: 1,
    emotional_focus: 2,
    movement_transition: 1,
    continuous_action: 2,
    reveal_delay: 1,
    climax_payoff: 2,
  },
  split_row: {
    intro_entry: 1,
    scale_space: 1,
    dialogue_exchange: 2,
    emotional_focus: 1,
    movement_transition: 2,
    continuous_action: 4,
    reveal_delay: 1,
    climax_payoff: 2,
  },
  stair_step: {
    intro_entry: 2,
    scale_space: 2,
    dialogue_exchange: 1,
    emotional_focus: 1,
    movement_transition: 5,
    continuous_action: 3,
    reveal_delay: 2,
    climax_payoff: 2,
  },
  closeup_pulse: {
    intro_entry: 1,
    scale_space: 1,
    dialogue_exchange: 4,
    emotional_focus: 5,
    movement_transition: 1,
    continuous_action: 1,
    reveal_delay: 3,
    climax_payoff: 2,
  },
  impact_tail: {
    intro_entry: 1,
    scale_space: 1,
    dialogue_exchange: 1,
    emotional_focus: 2,
    movement_transition: 1,
    continuous_action: 3,
    reveal_delay: 4,
    climax_payoff: 5,
  },
  vertical_panorama: {
    intro_entry: 3,
    scale_space: 5,
    dialogue_exchange: 0,
    emotional_focus: 1,
    movement_transition: 2,
    continuous_action: 1,
    reveal_delay: 1,
    climax_payoff: 2,
  },
  void_reveal: {
    intro_entry: 1,
    scale_space: 1,
    dialogue_exchange: 1,
    emotional_focus: 3,
    movement_transition: 1,
    continuous_action: 0,
    reveal_delay: 5,
    climax_payoff: 4,
  },
  continuity_chain: {
    intro_entry: 1,
    scale_space: 1,
    dialogue_exchange: 2,
    emotional_focus: 2,
    movement_transition: 3,
    continuous_action: 5,
    reveal_delay: 2,
    climax_payoff: 3,
  },
  motion_runway: {
    intro_entry: 1,
    scale_space: 2,
    dialogue_exchange: 0,
    emotional_focus: 0,
    movement_transition: 4,
    continuous_action: 5,
    reveal_delay: 1,
    climax_payoff: 3,
  },
  one_point_charge: {
    intro_entry: 2,
    scale_space: 2,
    dialogue_exchange: 0,
    emotional_focus: 1,
    movement_transition: 3,
    continuous_action: 4,
    reveal_delay: 2,
    climax_payoff: 4,
  },
};

const SIMPLICITY_RANK: Record<WebtoonCorePattern, number> = {
  stack_focus: 0,
  closeup_pulse: 1,
  stair_step: 2,
  hero_drop: 3,
  split_row: 4,
  impact_tail: 5,
  continuity_chain: 6,
  vertical_panorama: 7,
  motion_runway: 8,
  one_point_charge: 9,
  void_reveal: 10,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const round2 = (value: number) => Math.round(value * 100) / 100;

const makeEmptyIntentScores = (): IntentScoreMap => ({
  intro_entry: 0,
  scale_space: 0,
  dialogue_exchange: 0,
  emotional_focus: 0,
  movement_transition: 0,
  continuous_action: 0,
  reveal_delay: 0,
  climax_payoff: 0,
});

export function inferGapProfileForPattern(
  corePattern: WebtoonCorePattern,
  modifiers: WebtoonLayoutModifier[]
): WebtoonGapProfile {
  if (modifiers.includes("long_pause_gap")) return "dramatic";
  if (corePattern === "void_reveal") return "dramatic";
  if (corePattern === "impact_tail" || corePattern === "hero_drop" || corePattern === "vertical_panorama" || corePattern === "one_point_charge") return "breathing";
  if (corePattern === "closeup_pulse" || corePattern === "continuity_chain") return "tight";
  return "balanced";
}

export function inferFocusPanelIndexForPattern(
  panels: WebtoonDynamicPanel[],
  corePattern: WebtoonCorePattern
): number {
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

export function inferIntentScores(ctx: {
  narrativeFunction?: string;
  segmentRole?: WebtoonScrollSegmentRole | string;
  panelCount: number;
  focusPanelIndex: number;
  sceneTypes: WebtoonSceneType[];
  modifiers: WebtoonLayoutModifier[];
  gapProfile?: WebtoonGapProfile | string;
  heightWeights?: number[];
}): IntentScoreMap {
  const scores = makeEmptyIntentScores();
  const narrative = String(ctx.narrativeFunction || "").trim().toLowerCase();
  const segmentRole = String(ctx.segmentRole || "").trim().toLowerCase();
  const sceneTypes = ctx.sceneTypes;
  const heightWeights = ctx.heightWeights || [];
  const hasImpact = sceneTypes.includes("impact");
  const lastPanelIsFocus = ctx.focusPanelIndex === ctx.panelCount;
  const firstScene = sceneTypes[0];
  const maxHeightWeight = heightWeights.length > 0 ? Math.max(...heightWeights) : 0;

  if (narrative === "introduction") scores.intro_entry += 3;
  if (segmentRole === "intro") scores.intro_entry += 2;
  if (firstScene === "establishing") scores.intro_entry += 2;

  if (firstScene === "establishing") scores.scale_space += 3;
  if (ctx.focusPanelIndex === 1) scores.scale_space += 1;
  if ((ctx.panelCount === 2 || ctx.panelCount === 3) && maxHeightWeight >= 4) {
    scores.scale_space += 1;
  }

  scores.dialogue_exchange += Math.min(4, sceneTypes.filter((scene) => scene === "dialogue").length * 2);
  if (!hasImpact) scores.dialogue_exchange += 1;

  scores.emotional_focus += Math.min(4, sceneTypes.filter((scene) => scene === "emotional").length * 2);
  scores.emotional_focus += Math.min(4, sceneTypes.filter((scene) => scene === "closeup").length * 2);

  if (sceneTypes.includes("transition")) scores.movement_transition += 3;
  if (sceneTypes.includes("transition") && sceneTypes.includes("action")) {
    scores.movement_transition += 1;
  }

  scores.continuous_action += Math.min(4, sceneTypes.filter((scene) => scene === "action").length * 2);
  if (ctx.panelCount === 4 || ctx.panelCount === 5) scores.continuous_action += 2;

  if (String(ctx.gapProfile || "").toLowerCase() === "dramatic") scores.reveal_delay += 2;
  if (ctx.modifiers.includes("long_pause_gap")) scores.reveal_delay += 2;
  if (lastPanelIsFocus) scores.reveal_delay += 1;

  if (narrative === "climax") scores.climax_payoff += 3;
  if (segmentRole === "climax") scores.climax_payoff += 2;
  if (hasImpact) scores.climax_payoff += 2;
  if (lastPanelIsFocus) scores.climax_payoff += 1;

  for (const key of INTENT_TAGS) {
    scores[key] = clamp(scores[key], 0, 5);
  }

  return scores;
}

function computeHistoryAdjustment(pattern: WebtoonCorePattern, previousPatterns: string[]): number {
  const recent = previousPatterns.slice(-2);
  let adjustment = 0;

  if (recent[recent.length - 1] === pattern) adjustment -= 1.0;
  if (recent[recent.length - 2] === pattern) adjustment -= 0.6;
  if (recent.length === 2 && recent[0] === pattern && recent[1] === pattern) adjustment -= 1.2;

  const inRecentWindow = recent.includes(pattern);
  if (!inRecentWindow) adjustment += 0.6;

  const uniqueBefore = new Set(recent).size;
  const uniqueAfter = new Set([...recent, pattern]).size;
  if (uniqueAfter > uniqueBefore) adjustment += 0.4;

  return clamp(round2(adjustment), -2.8, 1.0);
}

function computeGateAdjustment(ctx: {
  pattern: WebtoonCorePattern;
  panelCount: number;
  sceneTypes: WebtoonSceneType[];
  focusPanelIndex: number;
  narrativeFunction?: string;
}): { adjustment: number; reasons: string[] } {
  const reasons: string[] = [];
  const narrative = String(ctx.narrativeFunction || "").trim().toLowerCase();
  const lastPanelIsFocus = ctx.focusPanelIndex === ctx.panelCount;

  if (ctx.pattern === "split_row" && ctx.panelCount < 3) {
    reasons.push("requires 3+ panels");
    return { adjustment: -99, reasons };
  }

  let adjustment = 0;

  if (
    ctx.pattern === "impact_tail" &&
    !ctx.sceneTypes.includes("impact") &&
    !lastPanelIsFocus
  ) {
    adjustment -= 1.4;
    reasons.push("impact tail without impact cue");
  }

  if (
    ctx.pattern === "closeup_pulse" &&
    !ctx.sceneTypes.some((scene) => scene === "dialogue" || scene === "emotional" || scene === "closeup")
  ) {
    adjustment -= 1.2;
    reasons.push("closeup pulse without emotional/dialogue cues");
  }

  if (
    ctx.pattern === "hero_drop" &&
    !(
      ctx.sceneTypes[0] === "establishing" ||
      ctx.focusPanelIndex === 1 ||
      narrative === "introduction"
    )
  ) {
    adjustment -= 1.3;
    reasons.push("hero drop without a strong opening cue");
  }

  if (
    ctx.pattern === "vertical_panorama" &&
    !(ctx.sceneTypes[0] === "establishing" || ctx.focusPanelIndex === 1)
  ) {
    adjustment -= 1.1;
    reasons.push("vertical panorama without scale opener");
  }

  if (
    ctx.pattern === "void_reveal" &&
    !(lastPanelIsFocus || ctx.sceneTypes.includes("impact") || ctx.sceneTypes.includes("transition"))
  ) {
    adjustment -= 1.2;
    reasons.push("void reveal without delayed payoff cue");
  }

  if (ctx.pattern === "continuity_chain" && ctx.panelCount < 4) {
    adjustment -= 0.8;
    reasons.push("continuity chain prefers 4+ panels");
  }

  if (
    ctx.pattern === "motion_runway" &&
    !(ctx.sceneTypes.includes("action") && (ctx.sceneTypes.includes("transition") || lastPanelIsFocus))
  ) {
    adjustment -= 1.2;
    reasons.push("motion runway without clear directional action");
  }

  if (
    ctx.pattern === "one_point_charge" &&
    !(ctx.sceneTypes.includes("action") || ctx.sceneTypes[0] === "establishing" || lastPanelIsFocus)
  ) {
    adjustment -= 1.0;
    reasons.push("one-point charge without perspective drive");
  }

  if (ctx.pattern === "stair_step" && ctx.sceneTypes.includes("transition")) {
    adjustment += 0.4;
    reasons.push("transition scene favors stair-step");
  }

  if (ctx.pattern === "vertical_panorama" && ctx.sceneTypes[0] === "establishing") {
    adjustment += 0.4;
    reasons.push("establishing scene favors vertical panorama");
  }

  if (ctx.pattern === "void_reveal" && lastPanelIsFocus) {
    adjustment += 0.3;
    reasons.push("last-panel focus supports reveal delay");
  }

  if (ctx.pattern === "continuity_chain" && ctx.panelCount >= 4) {
    adjustment += 0.3;
    reasons.push("multi-beat page supports continuity chain");
  }

  if (ctx.pattern === "motion_runway" && ctx.sceneTypes.includes("action") && ctx.sceneTypes.includes("transition")) {
    adjustment += 0.4;
    reasons.push("action plus transition favors motion runway");
  }

  if (ctx.pattern === "one_point_charge" && lastPanelIsFocus) {
    adjustment += 0.2;
    reasons.push("focused push-in supports one-point charge");
  }

  return { adjustment: round2(adjustment), reasons };
}

function recencyDistance(pattern: WebtoonCorePattern, previousPatterns: string[]): number {
  for (let index = previousPatterns.length - 1; index >= 0; index--) {
    if (previousPatterns[index] === pattern) {
      return previousPatterns.length - 1 - index;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function compareCloseCandidates(
  a: PatternScoreBreakdown,
  b: PatternScoreBreakdown,
  intents: IntentScoreMap,
  previousPatterns: string[]
): number {
  if (b.baseFit !== a.baseFit) return b.baseFit - a.baseFit;

  if (intents.emotional_focus >= 3) {
    if (a.pattern === "closeup_pulse" && b.pattern === "hero_drop") return -1;
    if (a.pattern === "hero_drop" && b.pattern === "closeup_pulse") return 1;
  }

  if (intents.scale_space >= 3) {
    if (a.pattern === "vertical_panorama" && b.pattern === "hero_drop") return -1;
    if (a.pattern === "hero_drop" && b.pattern === "vertical_panorama") return 1;
  }

  const recencyDiff =
    recencyDistance(b.pattern, previousPatterns) - recencyDistance(a.pattern, previousPatterns);
  if (recencyDiff !== 0) return recencyDiff;

  return SIMPLICITY_RANK[a.pattern] - SIMPLICITY_RANK[b.pattern];
}

export function scorePatternCandidate(ctx: {
  pattern: WebtoonCorePattern;
  intents: IntentScoreMap;
  previousPatterns: string[];
  panelCount: number;
  sceneTypes: WebtoonSceneType[];
  focusPanelIndex: number;
  narrativeFunction?: string;
}): PatternScoreBreakdown {
  const affinity = PATTERN_AFFINITY[ctx.pattern];
  const baseFit = round2(
    INTENT_TAGS.reduce((sum, intent) => sum + (ctx.intents[intent] * affinity[intent]) / 5, 0)
  );
  const historyAdjustment = computeHistoryAdjustment(ctx.pattern, ctx.previousPatterns);
  const gate = computeGateAdjustment({
    pattern: ctx.pattern,
    panelCount: ctx.panelCount,
    sceneTypes: ctx.sceneTypes,
    focusPanelIndex: ctx.focusPanelIndex,
    narrativeFunction: ctx.narrativeFunction,
  });
  const finalScore = round2(baseFit + historyAdjustment + gate.adjustment);

  const reasons: string[] = [];
  if (ctx.intents.intro_entry >= 3 && affinity.intro_entry >= 4) reasons.push("strong intro fit");
  if (ctx.intents.scale_space >= 3 && affinity.scale_space >= 4) reasons.push("strong scale fit");
  if (ctx.intents.dialogue_exchange >= 3 && affinity.dialogue_exchange >= 4) reasons.push("dialogue fit");
  if (ctx.intents.emotional_focus >= 3 && affinity.emotional_focus >= 4) reasons.push("emotional fit");
  if (ctx.intents.movement_transition >= 3 && affinity.movement_transition >= 4) reasons.push("movement fit");
  if (ctx.intents.continuous_action >= 3 && affinity.continuous_action >= 4) reasons.push("action continuity fit");
  if (ctx.intents.reveal_delay >= 3 && affinity.reveal_delay >= 4) reasons.push("reveal timing fit");
  if (ctx.intents.climax_payoff >= 3 && affinity.climax_payoff >= 4) reasons.push("climax payoff fit");
  if (historyAdjustment > 0) reasons.push("improves recent variety");
  if (historyAdjustment < 0) reasons.push("repeats recent pattern");
  reasons.push(...gate.reasons);

  return {
    pattern: ctx.pattern,
    baseFit,
    historyAdjustment,
    gateAdjustment: gate.adjustment,
    finalScore,
    reasons,
  };
}

export function chooseBestPattern(ctx: {
  availablePatterns: WebtoonCorePattern[];
  previousPatterns: string[];
  narrativeFunction?: string;
  segmentRole?: WebtoonScrollSegmentRole | string;
  panelCount: number;
  focusPanelIndex: number;
  sceneTypes: WebtoonSceneType[];
  modifiers: WebtoonLayoutModifier[];
  gapProfile?: WebtoonGapProfile | string;
  heightWeights?: number[];
}): {
  chosen: WebtoonCorePattern;
  intents: IntentScoreMap;
  breakdowns: PatternScoreBreakdown[];
} {
  const intents = inferIntentScores({
    narrativeFunction: ctx.narrativeFunction,
    segmentRole: ctx.segmentRole,
    panelCount: ctx.panelCount,
    focusPanelIndex: ctx.focusPanelIndex,
    sceneTypes: ctx.sceneTypes,
    modifiers: ctx.modifiers,
    gapProfile: ctx.gapProfile,
    heightWeights: ctx.heightWeights,
  });

  const breakdowns = ctx.availablePatterns.map((pattern) =>
    scorePatternCandidate({
      pattern,
      intents,
      previousPatterns: ctx.previousPatterns,
      panelCount: ctx.panelCount,
      sceneTypes: ctx.sceneTypes,
      focusPanelIndex: ctx.focusPanelIndex,
      narrativeFunction: ctx.narrativeFunction,
    })
  );

  breakdowns.sort((a, b) => b.finalScore - a.finalScore);

  let chosen = breakdowns[0];
  const closeCandidates = breakdowns.filter(
    (candidate) => chosen.finalScore - candidate.finalScore < 0.75
  );
  if (closeCandidates.length > 1) {
    closeCandidates.sort((a, b) =>
      compareCloseCandidates(a, b, intents, ctx.previousPatterns)
    );
    chosen = closeCandidates[0];
  }

  return {
    chosen: chosen.pattern,
    intents,
    breakdowns,
  };
}

export const DEFAULT_WEBTOON_PATTERN_CANDIDATES: WebtoonCorePattern[] = [
  ...WEBTOON_CORE_PATTERNS,
];
