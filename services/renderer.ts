
import { SeriesSpec, PageSpec, ImageSize, CharacterSpec, ComicMode, PublicationFormat, MangaColorMode, ImageProvider, CodexImageQuality, WebtoonScrollBeatKind } from "../types";
import { findClosestAspectRatio } from "./aspectRatio";
import { buildDynamicWebtoonTemplate } from "./webtoonLayoutBuilder";
import { parseDataUrl } from "./dataUrl";
import { postJson } from "./localApi";

const DEFAULT_CODEX_IMAGE_QUALITY: CodexImageQuality = "medium";
const DEFAULT_CODEX_IMAGE_MODEL = "gpt-5.5";
const GPT_IMAGE_DIMENSION_STEP = 16;
const GPT_IMAGE_MAX_EDGE = 3840;
const GPT_IMAGE_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_MIN_PIXELS = 655_360;
const GPT_IMAGE_MAX_LONG_TO_SHORT_RATIO = 3;
const WEBTOON_SCROLL_SEGMENT_CODEX_SIZE = "1024x3072";

const CONTENT_SAFETY_VISUAL_GUARD = [
  "[VISUAL CONTEXT]",
  "- Clear age-appropriate comic staging. Keep the scene natural and matched to the script's intended context.",
  "- Render speech-bubble text and educational labels as typography exactly as written.",
  "- For adult fashion, swimwear, sports, or leisure scenes, keep the adult context clear with natural full-body or waist-up composition."
].join("\n");

export interface FullPageImageRequest {
  prompt: string;
  referenceImages: string[];
  imageProvider: ImageProvider;
  codexImageModel: string;
  codexImageQuality: CodexImageQuality;
  codexSize: string;
}

const parseAspectRatioValue = (value: string): number | null => {
  const [wRaw, hRaw] = String(value || "").split(":");
  const w = Number.parseFloat(wRaw || "");
  const h = Number.parseFloat(hRaw || "");
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
};

const roundToImageStep = (value: number): number =>
  Math.max(GPT_IMAGE_DIMENSION_STEP, Math.round(value / GPT_IMAGE_DIMENSION_STEP) * GPT_IMAGE_DIMENSION_STEP);

const floorToImageStep = (value: number): number =>
  Math.max(GPT_IMAGE_DIMENSION_STEP, Math.floor(value / GPT_IMAGE_DIMENSION_STEP) * GPT_IMAGE_DIMENSION_STEP);

const ceilToImageStep = (value: number): number =>
  Math.max(GPT_IMAGE_DIMENSION_STEP, Math.ceil(value / GPT_IMAGE_DIMENSION_STEP) * GPT_IMAGE_DIMENSION_STEP);

const resolveSquareCodexImageSize = (imageSize: ImageSize): string => {
  if (imageSize === "4K") return "2880x2880";
  if (imageSize === "2K") return "2048x2048";
  return "1024x1024";
};

const resolveCodexImageSize = (imageSize: ImageSize, aspectRatio: string): string => {
  const rawRatio = parseAspectRatioValue(aspectRatio) || 9 / 16;
  const clampedRatio = Math.max(
    1 / GPT_IMAGE_MAX_LONG_TO_SHORT_RATIO,
    Math.min(GPT_IMAGE_MAX_LONG_TO_SHORT_RATIO, rawRatio)
  );
  const isSquare = Math.abs(clampedRatio - 1) < 0.08;
  if (isSquare) return resolveSquareCodexImageSize(imageSize);

  const isLandscape = clampedRatio > 1;
  const longToShortRatio = isLandscape ? clampedRatio : 1 / clampedRatio;
  const targetLongEdge =
    imageSize === "4K"
      ? GPT_IMAGE_MAX_EDGE
      : imageSize === "2K"
        ? 2048
        : Math.min(1792, roundToImageStep(1024 * longToShortRatio));
  const maxLongByPixels = floorToImageStep(Math.sqrt(GPT_IMAGE_MAX_PIXELS * longToShortRatio));
  let longEdge = Math.min(targetLongEdge, GPT_IMAGE_MAX_EDGE, maxLongByPixels);
  let shortEdge = ceilToImageStep(longEdge / longToShortRatio);

  while (longEdge * shortEdge > GPT_IMAGE_MAX_PIXELS && longEdge > GPT_IMAGE_DIMENSION_STEP) {
    longEdge -= GPT_IMAGE_DIMENSION_STEP;
    shortEdge = ceilToImageStep(longEdge / longToShortRatio);
  }
  while (longEdge * shortEdge < GPT_IMAGE_MIN_PIXELS && longEdge < GPT_IMAGE_MAX_EDGE) {
    longEdge += GPT_IMAGE_DIMENSION_STEP;
    shortEdge = ceilToImageStep(longEdge / longToShortRatio);
  }

  const width = isLandscape ? longEdge : shortEdge;
  const height = isLandscape ? shortEdge : longEdge;
  return `${width}x${height}`;
};

const getWebtoonPatternLabel = (pattern?: string): string => {
  const labels: Record<string, string> = {
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
  return labels[pattern || ""] || "Stack Focus";
};

const getWebtoonPatternDescription = (pattern?: string): string => {
  const descriptions: Record<string, string> = {
    stack_focus: "Use a clean mobile rhythm that alternates broader beats with narrower portrait reactions instead of repeating flat strips.",
    hero_drop: "One dominant hero beat should lead the strip, followed by tighter portrait-supporting beats.",
    split_row: "Mix staggered single beats with one compact side-by-side row to break monotony.",
    stair_step: "Offset panels left and right to create a staircase reading flow with asymmetric widths.",
    closeup_pulse: "Alternate medium-wide beats with narrower centered close-up panels for emotional pulse.",
    impact_tail: "Build with compact beats and white-space pauses, then land on one oversized climax panel.",
    vertical_panorama: "Anchor the page with sustained vertical depth so the reader feels scale, height, or descent while scrolling.",
    void_reveal: "Use compact setup beats, then preserve a deliberate empty pause before the reveal lands lower in the strip.",
    continuity_chain: "Break one event into multiple linked beats so the reader feels time and continuity through the scroll.",
    motion_runway: "Align action offsets and emphasis with the downward scroll direction for acceleration and momentum.",
    one_point_charge: "Center the composition around perspective pull, corridor depth, or a forward-driving attack into space.",
  };
  return descriptions[pattern || ""] || descriptions.stack_focus;
};

const getWebtoonModifierLine = (modifier: string): string => {
  const lines: Record<string, string> = {
    borderless_open: "- Include at least one open, borderless panel feel for air and emphasis.",
    inset_closeup: "- Include one inset-style close-up panel that overlaps or floats near a larger panel.",
    diagonal_cut: "- Use at least one angled or diagonal panel edge for energy.",
    overlap_bleed: "- Let the focus panel slightly overlap or bleed beyond the usual gutter rhythm.",
    long_pause_gap: "- Use one intentionally large empty gap between beats to create a pause.",
    micro_reaction: "- Include one compact reaction-sized panel for a quick emotional beat.",
  };
  return lines[modifier] || "";
};

const getWebtoonDynamicDescription = (page: PageSpec): string => {
  const webtoonLayout = page.layout.webtoon_layout;
  const corePattern = webtoonLayout?.core_pattern || "stack_focus";
  const gapProfile = webtoonLayout?.gap_profile || "balanced";
  const focusPanelIndex = webtoonLayout?.focus_panel_index || 1;
  const modifierText = webtoonLayout?.modifiers?.length
    ? `Modifiers: ${webtoonLayout.modifiers.join(", ")}. `
    : "";
  const panelDescs = page.panels.map((panel, index) => {
    const sceneType = webtoonLayout?.panels[index]?.scene_type;
    return `Panel ${index + 1}${sceneType ? ` ${sceneType}` : ""} (${panel.render.target_aspect_ratio})`;
  });
  return (
    `A single tall mobile webtoon page with ${page.panels.length} panels using the "${getWebtoonPatternLabel(corePattern)}" core pattern. ` +
    `${getWebtoonPatternDescription(corePattern)} ` +
    `Focus panel: Panel ${focusPanelIndex}. Gap rhythm: ${gapProfile}. ` +
    modifierText +
    `Panel structure: ${panelDescs.join(", ")}.`
  );
};

const getWebtoonScrollPatternLabel = (pattern?: string): string => {
  const labels: Record<string, string> = {
    dialogue_air: "Dialogue Air",
    emotional_pause_reveal: "Emotional Pause Reveal",
    action_runway: "Action Runway",
    vertical_panorama: "Vertical Panorama",
    micro_reaction_chain: "Micro Reaction Chain",
    impact_drop: "Impact Drop",
  };
  return labels[pattern || ""] || "Dialogue Air";
};

const getWebtoonScrollBeatLabel = (kind: WebtoonScrollBeatKind): string => {
  const labels: Record<WebtoonScrollBeatKind, string> = {
    panel: "framed panel",
    pause_space: "intentional empty pause space",
    bubble_space: "speech-bubble-only whitespace",
    borderless_scene: "borderless open scene",
    reaction_micro: "small reaction micro-beat",
    impact_panel: "large impact panel",
    transition_air: "quiet transition air",
  };
  return labels[kind] || kind;
};

const getWebtoonScrollChoreographyDescription = (page: PageSpec): string => {
  const choreography = page.layout.scroll_choreography;
  if (!choreography) return getWebtoonDynamicDescription(page);
  const beatSummary = choreography.beats
    .map((beat, index) => {
      const textIntent = beat.text_intent ? ` Text intent: ${beat.text_intent}.` : "";
      const layoutCue = [
        `width ${beat.width_profile || "medium"}`,
        `x ${beat.x_position || "center"}`,
        `shape ${beat.shape_style || "soft_border"}`,
        `vertical role ${beat.vertical_role || "tap"}`,
        `scroll distance ${beat.scroll_distance || "medium"}`,
      ].join(", ");
      return `${index + 1}) ${getWebtoonScrollBeatLabel(beat.kind)}, weight ${beat.height_weight}, ${beat.framing || "flexible"} framing, ${layoutCue}. ${beat.visual_intent}.${textIntent}`;
    })
    .join(" ");

  return (
    `A ${WEBTOON_SCROLL_SEGMENT_CODEX_SIZE} Korean vertical webtoon scroll segment using "${getWebtoonScrollPatternLabel(choreography.choreography_pattern)}". ` +
    `Segment role: ${choreography.segment_role}. Reading choreography: ${beatSummary}`
  );
};

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const getRectBounds = (panel: ReturnType<typeof buildDynamicWebtoonTemplate>["panels"][number]) => {
  if (panel.shape === "rect" && panel.rect) return panel.rect;
  const poly = panel.poly || [];
  const xs = poly.map((point) => point[0]);
  const ys = poly.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
};

const getWebtoonGeometryGuide = (page: PageSpec): string => {
  if (!page.layout.template_id.startsWith("webtoon_dynamic_") || !page.layout.webtoon_layout) {
    const templateId = page.layout.template_id;
    const staticGuides: Record<string, string[]> = {
      webtoon_hero_stack: [
        "- Panel 1: broad dominant hero beat across almost the full width at the top.",
        "- Panel 2: noticeably narrower portrait follow-up panel centered or slightly inset below.",
        "- Panel 3: the narrowest portrait reaction/cliffhanger beat near the bottom."
      ],
      webtoon_stack_3: [
        "- Panel 1: wider opening beat near full width.",
        "- Panel 2: portrait-leaning middle beat with clear side whitespace.",
        "- Panel 3: even narrower ending beat that reads like a reaction or hook."
      ],
      webtoon_stack_4: [
        "- Do not make all four beats the same width.",
        "- Mix one broader opener with two portrait-leaning middle beats and one narrow final beat.",
        "- Keep enough side whitespace so it reads like mobile webtoon pacing, not boxed strips."
      ],
      webtoon_impact: [
        "- Treat the entire page as one tall impact beat with a vertical reveal feel.",
        "- Do not redesign it into multiple hidden panels or card-like bands."
      ]
    };

    const lines = staticGuides[templateId];
    if (!lines) return "";
    return [
      "[PANEL GEOMETRY MAP]",
      "- Respect the fixed composition below. Do not flatten it into equal horizontal bands.",
      ...lines
    ].join("\n");
  }

  const template = buildDynamicWebtoonTemplate(page.layout.webtoon_layout);
  const orderedPanels = [...template.panels].sort((a, b) => getRectBounds(a).y - getRectBounds(b).y);

  return [
    "[PANEL GEOMETRY MAP]",
    "- Respect these approximate panel boxes. Do NOT redraw the page as equal full-width strips.",
    "- Narrow portrait beats should stay narrow. Only the designated hero/impact beats may span nearly the full width.",
    ...orderedPanels.map((panel) => {
      const bounds = getRectBounds(panel);
      const sceneType = page.layout.webtoon_layout?.panels[panel.panel_index - 1]?.scene_type || "beat";
      const widthCue = bounds.w >= 0.84 ? "broad hero/action beat" : bounds.w <= 0.52 ? "narrow portrait beat" : "medium supporting beat";
      const shapeCue = panel.shape === "poly" ? "angled panel" : "rectangular panel";
      return `- Panel ${panel.panel_index}: ${shapeCue}, x ${formatPercent(bounds.x)}, y ${formatPercent(bounds.y)}, w ${formatPercent(bounds.w)}, h ${formatPercent(bounds.h)}; ${sceneType}; ${widthCue}.`;
    })
  ].join("\n");
};

const getStaticWebtoonDescription = (templateId: string): string => {
  const descriptions: Record<string, string> = {
    webtoon_stack_3: "A mobile-first vertical webtoon page with one broader opening beat followed by increasingly portrait, inset panels for a stronger vertical reading flow.",
    webtoon_hero_stack: "A webtoon hero composition with one dominant opening beat followed by tighter portrait follow-up panels that intensify the vertical mobile rhythm.",
    webtoon_stack_4: "A dense mobile webtoon page with four stacked beats that mix medium-wide and portrait panels instead of repeating flat horizontal strips.",
    webtoon_impact: "A single tall vertical impact panel for a cliffhanger, reveal, or emotional climax in webtoon format.",
  };
  return descriptions[templateId] || "A vertical webtoon strip with a fixed mobile-friendly panel composition.";
};

const getStaticWebtoonStructureRules = (page: PageSpec): string => {
  const templateId = page.layout.template_id;

  return [
    "[Structural Requirement - Static Webtoon Strip]",
    `- EXACTLY ${page.panels.length} panels on this vertical strip image.`,
    "- Preserve the PROVIDED fixed webtoon composition. Do NOT redesign it into a different layout.",
    "- Reading flow must remain TOP-TO-BOTTOM and feel comfortable on a phone screen.",
    "- Keep a clean webtoon feel: airy whitespace, minimal heavy framing, and clear separation between beats.",
    templateId === "webtoon_hero_stack"
      ? "- Panel 1 must be the dominant hero beat. Panels 2 and 3 should feel like lighter follow-up beats stacked underneath."
      : "",
    templateId === "webtoon_stack_3"
      ? "- Maintain a three-beat stacked mobile rhythm that narrows as it descends, ending in a clearly portrait-leaning final beat."
      : "",
    templateId === "webtoon_stack_4"
      ? "- Maintain a four-beat stacked rhythm with a mix of medium-wide and portrait panels, not four identical horizontal strips."
      : "",
    templateId === "webtoon_impact"
      ? "- This page is a SINGLE tall impact image. Treat it as a cliffhanger/reveal/emotional climax, not a generic poster."
      : "",
    "- Keep text containers mobile-readable and inside each panel.",
    `- Follow the "${templateId}" pattern described above.`,
  ]
    .filter(Boolean)
    .join("\n");
};

const getWebtoonStructureRules = (page: PageSpec): string => {
  if (!page.layout.template_id.startsWith("webtoon_dynamic_")) {
    return getStaticWebtoonStructureRules(page);
  }

  const webtoonLayout = page.layout.webtoon_layout;
  const corePattern = webtoonLayout?.core_pattern || "stack_focus";
  const focusPanelIndex = webtoonLayout?.focus_panel_index || 1;
  const modifierLines = (webtoonLayout?.modifiers || [])
    .map(getWebtoonModifierLine)
    .filter(Boolean);

  return [
    "[Structural Requirement - Webtoon Strip]",
    `- EXACTLY ${page.panels.length} panels on this vertical strip image.`,
    "- Primary reading flow must go TOP-TO-BOTTOM with deliberate white space between beats.",
    `- Core pattern: ${getWebtoonPatternLabel(corePattern)}. ${getWebtoonPatternDescription(corePattern)}`,
    `- Focus panel: Panel ${focusPanelIndex}. Make it visually dominant and memorable.`,
    "- Keep reaction and dialogue beats portrait-leaning when possible; do not stretch every beat into a wide banner.",
    corePattern === "split_row"
      ? "- Include one compact side-by-side split row while keeping the overall mobile readability intact."
      : "",
    corePattern === "stair_step"
      ? "- Offset some panels left/right instead of making every panel the same full-width rectangle."
      : "",
    corePattern === "closeup_pulse"
      ? "- Mix wider panels with at least one narrower centered close-up panel."
      : "",
    corePattern === "impact_tail"
      ? "- Reserve one oversized climax panel near the end of the strip."
      : "",
    corePattern === "vertical_panorama"
      ? "- Preserve one depth-led tall beat so the page feels vertically spacious rather than just stacked."
      : "",
    corePattern === "void_reveal"
      ? "- Keep the setup compact and leave a pronounced pause before the reveal beat lower in the strip."
      : "",
    corePattern === "continuity_chain"
      ? "- Split one continuous event into several linked beats; avoid making every panel feel like a separate scene."
      : "",
    corePattern === "motion_runway"
      ? "- Offset action beats to support a downward or diagonal-forward sense of acceleration."
      : "",
    corePattern === "one_point_charge"
      ? "- Keep the strongest beat centered around perspective pull or a forward-driving charge into depth."
      : "",
    "- Never use three consecutive equal full-width horizontal bands unless the page is an intentional single-impact reveal.",
    "- Panels should feel mobile-readable and intentionally varied, not cloned into equal strips.",
    "- Prefer whitespace separation over thick black frame lines unless the composition clearly needs a border.",
    ...modifierLines,
    page.layout.template_id.startsWith("webtoon_dynamic_")
      ? "- CRITICAL: Do NOT collapse this page into identical full-width rectangles. Vary height, width, and emphasis according to the chosen pattern."
      : `- Follow the "${page.layout.template_id}" pattern described above.`,
  ]
    .filter(Boolean)
    .join("\n");
};

const getWebtoonScrollChoreographyRules = (page: PageSpec): string => {
  const choreography = page.layout.scroll_choreography;
  if (!choreography) return getWebtoonStructureRules(page);

  return [
    "[Structural Requirement - Webtoon Scroll Segment]",
    `- Create ONE continuous Korean webtoon scroll segment at ${WEBTOON_SCROLL_SEGMENT_CODEX_SIZE}.`,
    "- Reading flow must move from TOP to BOTTOM as a single mobile scroll, not as a print comic page.",
    `- Choreography pattern: ${getWebtoonScrollPatternLabel(choreography.choreography_pattern)}.`,
    `- Segment role: ${choreography.segment_role}.`,
    "- Treat whitespace as time, silence, suspense, or emotional distance. Empty space is an intentional beat.",
    "- Do NOT render this as a stack of equal full-width boxes.",
    "- Do NOT interpret Script Beat 1/2/3 as mandatory panel boxes.",
    "- Do NOT force every beat into a bordered panel. Borderless scenes, floating bubbles, and pause spaces may exist without panel frames.",
    "- The number of script beats is story material only; the visual rhythm must follow the scroll choreography map.",
    "- Vary horizontal width like Korean webtoons: full-width beats are occasional, while medium, narrow, and tiny floating panels create rhythm.",
    "- Vary horizontal placement: do not center every beat. Use left, right, and drifting positions when cued.",
    "- Vary shapes: use borderless areas, soft borders, diagonal cuts, insets, and overlaps when cued.",
    "- Make long/very_long beats visibly occupy more vertical scroll distance than short tap beats.",
    "- Use soft/minimal borders only where a beat is explicitly a framed panel or impact panel.",
    "- Preserve clear top-to-bottom ordering even when panels are offset, borderless, or floating.",
    "",
    "[SCROLL CHOREOGRAPHY MAP]",
    ...choreography.beats.map((beat, index) => {
      const textIntent = beat.text_intent ? ` Text: ${beat.text_intent}.` : "";
      return `- Beat ${index + 1}: ${getWebtoonScrollBeatLabel(beat.kind)}; vertical weight ${beat.height_weight}; width ${beat.width_profile || "medium"}; x-position ${beat.x_position || "center"}; shape ${beat.shape_style || "soft_border"}; vertical role ${beat.vertical_role || "tap"}; scroll distance ${beat.scroll_distance || "medium"}; framing ${beat.framing || "flexible"}; intent: ${beat.visual_intent}.${textIntent}`;
    }),
    "",
    "[SCRIPT BEAT MATERIAL]",
    `- Use the ${page.panels.length} script beat descriptions below as story material in order.`,
    "- They must NOT become identical hard-bordered boxes one-for-one.",
    "- Merge, float, or stage them as webtoon beats when the choreography calls for pause_space, bubble_space, borderless_scene, reaction_micro, or transition_air.",
    "- Keep all readable text from the script, but place it where the choreography says it belongs.",
  ].join("\n");
};

const getWebtoonFormatRules = (page?: PageSpec): string => {
  if (page?.layout.scroll_choreography) {
    return [
      "[WEBTOON FORMAT RULES]",
      `- This is a ${WEBTOON_SCROLL_SEGMENT_CODEX_SIZE} vertical Korean webtoon scroll segment, not a 9:16 page card.`,
      "- Use a long mobile-scroll rhythm with visible breathing room.",
      "- Use whitespace as pacing, not just as a separator.",
      "- It is valid for some beats to be only blank space, a floating speech bubble, a borderless background, or a tiny reaction close-up.",
      "- Favor Korean mobile-webtoon staging: small floating panels, asymmetric left/right placement, open borderless scenes, silence gaps before reveals, diagonal/inset beats, and one strong lower impact when appropriate.",
      "- Avoid a uniform ladder of same-width rectangles. The segment should feel rhythmic: small tap beats, long vertical drops, and varied widths.",
      "- Full color digital art with clean, modern rendering.",
      "- Speech bubbles should be large, clean, and easily readable on a phone screen.",
    ].join("\n");
  }

  if (page && !page.layout.template_id.startsWith("webtoon_dynamic_")) {
    return [
      "[WEBTOON FORMAT RULES]",
      "- This is a STATIC vertical webtoon strip for mobile reading.",
      "- Preserve the fixed composition, but keep the final image feeling like a modern Korean webtoon rather than a boxed print comic page.",
      "- Use whitespace, vertical breathing room, and clean panel staging to support mobile readability.",
      "- Favor soft or minimal borders unless a hard edge is clearly needed for emphasis.",
      "- Full color digital art with clean, modern rendering.",
      "- Speech bubbles should be large, clean, and easy to read on a phone screen.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const corePattern = page?.layout.webtoon_layout?.core_pattern;
  return [
    "[WEBTOON FORMAT RULES]",
    "- This is a single tall WEBTOON PAGE designed for mobile readability.",
    "- Keep the read order obvious from top to bottom, but do not flatten every page into the same repeating strip.",
    "- Use white space as pacing, not just as a separator.",
    "- Favor Korean mobile-webtoon staging: broad hero beats sparingly, portrait reaction beats often, and strong silence gaps before reveals.",
    corePattern ? `- Preserve the chosen core pattern: ${getWebtoonPatternLabel(corePattern)}.` : "",
    "- Full color digital art with clean, modern rendering.",
    "- Speech bubbles should be large, clean, and easily readable on a phone screen.",
    "- Each panel should feel self-contained while still contributing to one page-level reading rhythm.",
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * 템플릿 ID를 AI가 이해할 수 있는 시각적 레이아웃 설명으로 변환합니다.
 */
const getLayoutDescription = (templateId: string, page?: PageSpec): string => {
  // 동적 웹툰 템플릿
  if (templateId.startsWith("webtoon_dynamic_")) {
    if (!page) return "A single tall mobile webtoon page with panels of varying heights.";
    return getWebtoonDynamicDescription(page);
  }
  if (templateId.startsWith("webtoon_")) {
    return getStaticWebtoonDescription(templateId);
  }

  const descriptions: Record<string, string> = {
    "classic_grid": "A standard 2x2 grid with four equal-sized square panels. Balanced and stable.",
    "hero_top": "One large wide cinematic panel on top (hero cut), with three smaller vertical panels arranged side-by-side underneath.",
    "hero_bottom": "Three small vertical panels on top, leading to one large, impactful horizontal climax panel at the bottom.",
    "diagonal_split_v1": "A dynamic layout using diagonal lines to split panels. Sharp angles and high-energy composition.",
    "diagonal_v2": "Aggressive diagonal split for the top two panels, with two standard horizontal strips below. Very action-oriented.",
    "inset_focus": "A large main background panel with a small 'inset' detail panel overlapping its corner. Two smaller panels at the bottom.",
    "masonry_alt": "Asymmetric masonry layout. Various panel sizes (tall vs wide) interlocking like a puzzle for a modern webtoon feel.",
    "wide_strips": "Four cinematic wide horizontal strips stacked vertically. Focuses on environmental storytelling.",
    "triptych_hero": "One very tall vertical panel on the left covering the full height, with three small square panels stacked on the right.",
    "sandwich": "One wide panel at the top, two vertical panels in the middle, and one wide panel at the bottom.",
    "quad_asymmetric": "Four panels with varying widths and heights, creating a non-uniform but structured rhythm.",
    "inset_strip": "Wide horizontal strips where one panel contains a smaller 'picture-in-picture' inset for close-ups.",
    "i2v_frame_16_9": "Single full-frame cinematic canvas (16:9).",
    "i2v_frame_9_16": "Single full-frame vertical canvas (9:16).",
    "i2v_frame_1_1": "Single full-frame square canvas (1:1).",
    "manga_6panel_classic": "Classic manga 3-row x 2-column grid (6 panels). Reading order: right-to-left, top-to-bottom.",
    "manga_5panel_dynamic": "Dynamic manga page with one large hero panel (top-right) and four smaller panels. Right-to-left reading order.",
    "manga_7panel_dense": "Dense action manga page with 7 panels of varied sizes. Right-to-left reading order with a full-width panel in the middle."
  };
  return descriptions[templateId] || "A multi-panel comic layout with 4 distinct sections divided by white gutters.";
};

const svgToDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const getErrorPlaceholderByAspect = (aspectRatio: string): string => {
  const config =
    aspectRatio === "16:9"
      ? { width: 1600, height: 900, label: "Frame Generation Error" }
      : aspectRatio === "1:1"
        ? { width: 1024, height: 1024, label: "Image Generation Error" }
        : { width: 900, height: 1600, label: "Page Generation Error" };

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}">
      <rect width="100%" height="100%" fill="#111827"/>
      <rect x="28" y="28" width="${config.width - 56}" height="${config.height - 56}" rx="32" fill="#1f2937" stroke="#f8fafc" stroke-width="8" stroke-dasharray="20 14"/>
      <text x="50%" y="44%" text-anchor="middle" fill="#f8fafc" font-family="Arial, sans-serif" font-size="${Math.max(40, Math.round(config.width * 0.04))}" font-weight="700">
        ${config.label}
      </text>
      <text x="50%" y="54%" text-anchor="middle" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="${Math.max(22, Math.round(config.width * 0.022))}" font-weight="600">
        The reader will keep this page visible instead of going blank.
      </text>
    </svg>
  `.trim();

  return svgToDataUrl(svg);
};

export const buildFullPageImageRequest = (
  series: SeriesSpec,
  page: PageSpec,
  imageSize: ImageSize,
  comicModeOverride?: ComicMode,
  options?: {
    styleConsistencyImage?: string | null;
    imageProvider?: ImageProvider;
    codexImageQuality?: CodexImageQuality;
    codexImageModel?: string;
  }
): FullPageImageRequest => {
  const compatibleImageSize = imageSize;
  const seriesLanguage = series?.series?.language || "ko";
  const style = series.anchors.style;
  const styleReferenceImage = series.anchors.style.style_reference_image;
  const styleConsistencyImage = String(options?.styleConsistencyImage || "").trim() || null;
  const product = series.anchors.product;
  const cast = Array.isArray(series.anchors.cast) ? series.anchors.cast : [];
  const primaryProtagonist = cast.find((c) => c?.role === "protagonist");
  const charAppearance = primaryProtagonist?.analyzed_appearance || primaryProtagonist?.appearance || series.anchors.protagonist.appearance;
  const charRole = series.anchors.protagonist.role;
  const supportingCast = series.anchors.supporting_cast?.trim();
  const characterConsistencyMode = series.constraints?.character_consistency_mode || "loose";
  const comicMode: ComicMode = comicModeOverride || series.constraints?.comic_mode || "learning";
  const creationType = series.constraints?.creation_type || "educational";
  const isStoryMode = creationType === "story";
  const storyAntiEducationGuardEnabled = isStoryMode ? series.constraints?.story_anti_education_guard !== false : true;
  const outputMode = series.constraints?.output_mode || "comic";
  const publicationFormat: PublicationFormat = series.constraints?.publication_format || (outputMode === "kling_i2v" ? "kling_i2v" : "learning_comic");
  const mangaColorMode: MangaColorMode = series.constraints?.manga_color_mode || "bw";
  const isKlingI2V = publicationFormat === "kling_i2v";
  const isWebtoon = publicationFormat === "webtoon";
  const isManga = publicationFormat === "manga";
  const isWebtoonScrollSegment = isWebtoon && Boolean(page.layout.scroll_choreography);
  const layoutVisualGoal = isWebtoonScrollSegment
    ? getWebtoonScrollChoreographyDescription(page)
    : getLayoutDescription(page.layout.template_id, page);
  const i2vAspectRatio = series.constraints?.i2v_aspect_ratio || "16:9";
  const isLearningComic = publicationFormat === "learning_comic";
  const resolvedAspectRatio = isKlingI2V
    ? i2vAspectRatio
    : (isLearningComic || isWebtoon)
      ? "9:16"
      : findClosestAspectRatio(page.layout.canvas.w, page.layout.canvas.h);
  const imageProvider: ImageProvider = "codex";
  const codexImageQuality: CodexImageQuality =
    options?.codexImageQuality || series.constraints?.codex_image_quality || DEFAULT_CODEX_IMAGE_QUALITY;
  const codexImageModel = String(options?.codexImageModel || DEFAULT_CODEX_IMAGE_MODEL).trim() || DEFAULT_CODEX_IMAGE_MODEL;
  const isEduCinematic = comicMode === "cinematic";
  const isPureCinematic = comicMode === "pure_cinematic";

  const freqLabel = (freq?: CharacterSpec["catchphrase_frequency"]) => {
    if (freq === "often") return "often";
    if (freq === "sometimes") return "sometimes";
    return "rare";
  };

  const formatCharacterLine = (c: CharacterSpec): string => {
    const name = String(c.name || "").trim() || "Unnamed";
    const appearance = String(c.analyzed_appearance || c.appearance || "").trim();
    const persona = String(c.persona || "").trim();
    const catchphrase = String(c.catchphrase || "").trim();
    const parts: string[] = [name];
    if (c.role) parts.push(`ROLE_TAG: ${c.role}`);
    if (appearance) parts.push(`APPEARANCE: ${appearance}`);
    if (persona) parts.push(`PERSONA: ${persona}`);
    if (catchphrase) parts.push(`CATCHPHRASE (${freqLabel(c.catchphrase_frequency)}): "${catchphrase}"`);
    return parts.join(" | ");
  };

  const castProtagonists = cast.filter((c) => c?.role === "protagonist");
  const castSupporting = cast.filter((c) => c?.role === "supporting");

  /** scene 필드에서 인용된 대사 텍스트와 인용 동사구를 제거하여 Gemini의 이중 렌더링 방지 */
  const stripDialogueFromScene = (scene: string): string => {
    return scene
      // 1) 한국어/일본식 따옴표로 감싼 대사 제거
      .replace(/['''][^''']+[''']/g, "")
      .replace(/["""][^"""]+["""][!?]*/g, "")
      .replace(/「[^」]+」/g, "")
      .replace(/『[^』]+』/g, "")
      // 2) 인용 동사구 제거: ~(이)라고 말하며/외치며/...
      .replace(/(이)?라고\s*(말하|외치|중얼거리|속삭이|소리치|묻|대답하|이야기하|설명하|부르짖|읊조리|답하|되뇌|투덜거리|소곤거리|한탄하|울부짖)\S*/g, "")
      // 3) 정리: 다중 공백 → 단일 공백, 앞뒤 trim
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  /** 대사 문자열에서 [thought]/[narration] 태그를 파싱 */
  const parseDialogueTag = (raw: string): { type: "speech" | "thought" | "narration"; text: string } => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[thought]")) return { type: "thought", text: trimmed.slice("[thought]".length).trim() };
    if (trimmed.startsWith("[narration]")) return { type: "narration", text: trimmed.slice("[narration]".length).trim() };
    return { type: "speech", text: trimmed };
  };

  const containerLabel = (type: "speech" | "thought" | "narration"): string => {
    if (type === "thought") return "THOUGHT CLOUD";
    if (type === "narration") return "NARRATION BOX";
    return "SPEECH BUBBLE";
  };

  const buildTextCueLines = (dialogues: string[]) => dialogues.map(d => {
    const noSpeaker = d.replace(/^(주인공|나레이션|해설자|캐릭터|[\w\s가-힣]+)\s*[:：]\s*/i, "").trim();
    return parseDialogueTag(noSpeaker);
  });

  // 패널별 대사 및 장면 정보 요약
  const panelDescriptions = page.panels.map(p => {
    // 화자 이름이 포함되어 있다면 제거 (방어적 코드)
    const cleanedDialogues = buildTextCueLines(p.dialogues);
    const bubbles = cleanedDialogues.map((d, i) => `${i + 1}) [${containerLabel(d.type)}] "${d.text}"`).join('\n');
    return `
[Panel ${p.index} Visuals]
Scene: ${stripDialogueFromScene(p.scene)}
Acting/Gestures: ${p.acting || "Natural gestures that match the selected tone."}
Camera/Mood: ${p.camera}, ${p.mood}
Text to Render:
${bubbles}
    `.trim();
  }).join('\n\n');

  const scrollScriptMaterial = page.panels.map((p, index) => {
    const cleanedDialogues = buildTextCueLines(p.dialogues);
    const textCues = cleanedDialogues.length > 0
      ? cleanedDialogues.map((d, i) => `${i + 1}) [${containerLabel(d.type)}] "${d.text}"`).join("\n")
      : "(no text cue)";
    return `
[Script Beat ${index + 1}]
Story action: ${stripDialogueFromScene(p.scene)}
Performance: ${p.acting || "Natural gestures that match the selected tone."}
Camera / mood cue: ${p.camera}, ${p.mood}
Text cue:
${textCues}
    `.trim();
  }).join("\n\n");

  const roleNote = charRole === "narrator"
    ? (isStoryMode || isPureCinematic)
      ? "NOTE: The PROTAGONIST is an OBSERVER/REACTOR. No lecture stance. Convey context through reaction, movement, and blocking."
      : isEduCinematic
        ? "NOTE: The PROTAGONIST is a GUIDE/OBSERVER. Keep exposition minimal and show the educational core through actions and visual beats."
        : "NOTE: The PROTAGONIST is a NARRATOR/GUIDE. They should be shown pointing at, observing, or explaining the subject matter (e.g. other people, scientific models). They should NEVER be the main person acting in the scene unless the scene description explicitly says they are doing a demonstration."
    : (isStoryMode || isPureCinematic)
      ? "NOTE: The PROTAGONIST is an ACTOR and emotional center. Drive the story with choices, conflict, and visible consequences."
      : "NOTE: The PROTAGONIST is an ACTOR. They are the central figure in every scene, performing the actions and roleplaying the topic personally.";

  const toneMode = series.anchors.tone_mode || "normal";
  const toneLevel = series.anchors.tone_level || "medium";
  const toneNote =
    toneMode === "gag"
      ? `STORY TONE MODE: Gag (comedic)\nGAG LEVEL: ${toneLevel}\n- low: subtle reactions, minimal slapstick.\n- medium: playful reactions + occasional visual jokes.\n- high: frequent comedic beats and exaggerated expressions.\n- Do NOT add offensive stereotypes, hate, or explicit sexual content.`
      : isStoryMode
        ? `STORY TONE MODE: Normal\n- Keep visuals cinematic-first: dramatic framing, emotional contrast, and story momentum over exposition.\n- Non-graphic action beats (combat/chase/collision) are allowed when the script calls for them; avoid gore.${storyAntiEducationGuardEnabled ? "\n- This is a creative/narrative work — do NOT add educational framing, captions, or explanatory overlays." : ""}`
        : isPureCinematic
          ? "STORY TONE MODE: Normal\n- Keep visuals cinematic-first: dramatic framing, emotional contrast, and story momentum over exposition.\n- Non-graphic action beats (combat/chase/collision) are allowed when the script calls for them; avoid gore."
          : isEduCinematic
            ? "STORY TONE MODE: Normal\n- Keep visuals show-don't-tell while preserving educational clarity."
            : "STORY TONE MODE: Normal\n- Keep educational intent in story clarity, but visual rendering must strictly follow the selected style (do not fallback to generic educational comic defaults).";

  const delivery = series.anchors.delivery;
  const deliveryNote = delivery
    ? `TONE & GESTURE PRESET: ${delivery.preset_label}\nINSTRUCTIONS: ${delivery.instruction}`
    : isStoryMode
      ? "TONE & GESTURE PRESET: Story/Creative default\nINSTRUCTIONS: Use natural spoken dialogue with subtext; prioritize performance-driven gestures and emotional expression over explanation."
      : isPureCinematic
        ? "TONE & GESTURE PRESET: Cinematic default\nINSTRUCTIONS: Use natural spoken dialogue with subtext; prioritize performance-driven gestures over explanation."
        : isEduCinematic
          ? "TONE & GESTURE PRESET: Edu-cinematic default\nINSTRUCTIONS: Keep dialogue concise and clear; show learning points through staging and reactions."
          : "TONE & GESTURE PRESET: Standard polite Korean\nINSTRUCTIONS: Keep a clean, friendly explanatory tone; use natural gestures.";

  const castBlock =
    cast.length > 0
      ? `
PROTAGONISTS (if present):
${castProtagonists.length > 0 ? castProtagonists.map((c) => `- ${formatCharacterLine(c)}`).join("\n") : "- (none)"}

RECURRING SUPPORTING CHARACTERS (if present):
${castSupporting.length > 0 ? castSupporting.map((c) => `- ${formatCharacterLine(c)}`).join("\n") : "- (none)"}
`.trim()
      : "";

  const supportingCastNote = cast.length > 0
    ? `\n\nCAST NOTE:\n- Keep the cast's visual identity consistent across panels/pages.\n- Do NOT add speaker names inside bubbles.\n${castBlock ? `\n${castBlock}` : ""}`
    : (supportingCast
      ? `\nRECURRING CHARACTERS (if present): ${supportingCast}\n- Keep these characters' visual identity consistent across panels/pages.`
      : "");

  const characterIdentityBlock =
    characterConsistencyMode === "strict"
      ? `
**CRITICAL INSTRUCTION: CHARACTER IDENTITY PRESERVATION (최우선)**
**You are strictly prohibited from altering the protagonist's facial features, hairstyle, body proportions, or outfit between panels unless the scene explicitly demands it (e.g., "changed clothes", "disguise", time jump).**

[캐릭터 동일성 유지 규칙 - 가장 중요]
- 주인공의 얼굴 형태, 헤어스타일, 헤어 색상, 체형, 피부톤, 의상(색/패턴/액세서리)을 모든 패널에서 동일하게 유지하세요.
- 컷마다 새로운 복장을 임의로 창작하거나, 헤어/나이/핵심 특징을 랜덤 변형하지 마세요.
- 참조 이미지가 첨부된 경우, 해당 인물과 동일한 인물을 그리세요. 새로운 인물을 생성하지 마세요.
- 예외: scene 설명에 '갈아입음/변장/시간 점프' 등이 명시된 경우에만 변경을 허용합니다.
- 자유: 표정, 포즈, 구도, 카메라 앵글은 패널마다 자유롭게 변경할 수 있습니다.`
      : `
[CHARACTER IDENTITY NOTE]
- Keep the protagonist's core visual identity (face, hair, body type, outfit colors) consistent across all panels.
- Reference images are attached — the character in the output should match the reference, not be a new person.
- Expressions, poses, and camera angles should vary naturally between panels.`;

  const characterConsistencyNote = "";

  const productNote =
    product && Array.isArray(product.reference_images) && product.reference_images.filter(Boolean).length > 0
      ? `\n\nPRODUCT NOTE:\n- A product reference image is attached. Depict the product consistently across panels (shape, color, key details).\n- Do NOT copy logos or exact text from the reference photo. Use simplified, generic branding when needed.`
      : "";

  const bubbleLanguageRule =
    seriesLanguage === "en"
      ? '4) RENDER ENGLISH TEXT: Write the English text clearly inside the bubbles.'
      : "4) RENDER KOREAN TEXT: Write the KOREAN text (Hangul) clearly inside the bubbles.";

  const fontReadabilityRule =
    seriesLanguage === "en"
      ? "6) READABILITY: Use clean, legible fonts for Latin characters."
      : "6) READABILITY: Use clean, legible fonts for the Hangul characters.";

  const finalQualityLanguageCheck =
    seriesLanguage === "en"
      ? "- Is the English text rendered and not cut off? Yes."
      : "- Is the Korean text rendered and not cut off? Yes.";

  const stylePrompt = String(style.style_prompt || "").trim();
  const userStylePrompt = String(style.user_style_prompt || "").trim();
  const negativeStylePrompt = String(style.negative_style_prompt || "").trim();
  const styleProbe = `${style.preset_id} ${style.preset_label} ${stylePrompt} ${userStylePrompt}`;
  const styleNameProbe = `${style.preset_id} ${style.preset_label}`;
  const isMangaStyle = /(manga|shonen|shoujo|seinen|josei|망가|만가|만화)/i.test(styleProbe);
  const isWebtoonStyle = /(webtoon|웹툰)/i.test(styleProbe);
  const isRealismStyle = /(realism|photoreal|photo-real|cinematic still|실사)/i.test(styleProbe);
  const isMonochromeStyle = /(_bw|bw_|black.?white|monochrome|grayscale|흑백)/i.test(
    styleNameProbe
  );
  const shouldForceBlackAndWhiteManga = isManga && mangaColorMode === "bw";
  const shouldForceColorManga =
    isMangaStyle && !isMonochromeStyle && !shouldForceBlackAndWhiteManga;
  const effectiveStylePrompt = shouldForceColorManga
    ? stylePrompt
        .replace(/high contrast black and white with occasional tone/gi, "high contrast full color with tone-like shading")
        .replace(/high contrast black and white/gi, "high contrast full color")
        .replace(/\bblack and white\b/gi, "full color")
        .replace(/\bblack-and-white\b/gi, "full-color")
    : shouldForceBlackAndWhiteManga
      ? stylePrompt
        .replace(/full color manga/gi, "black-and-white manga")
        .replace(/rich vibrant palette/gi, "rich monochrome value range")
        .replace(/vibrant palette/gi, "monochrome value range")
        .replace(/vibrant colors/gi, "monochrome values")
        .replace(/colored shading/gi, "screentone shading")
        .replace(/full-color/gi, "black-and-white")
        .replace(/full color/gi, "black and white")
    : stylePrompt;

  const technicalInstruction =
    style.render_mode === "photoreal"
      ? "TECHNICAL: Photoreal camera realism aligned with the selected style mood, clear panel borders, 12pt white gutters."
      : isMonochromeStyle
      ? "TECHNICAL: Crisp ink linework, high-contrast black-and-white values, screentone/halftone shading, clear panel borders, 12pt white gutters."
      : isWebtoonScrollSegment
        ? "TECHNICAL: Clean full-color Korean webtoon long-scroll segment, 1024x3072, no enclosing card frame, no equal boxed strips, large intentional white breathing spaces, borderless open scenes when cued, readable mobile speech bubbles."
      : isWebtoon
        ? "TECHNICAL: Clean full-color digital rendering aligned with the selected style, soft or minimal borders, generous white breathing room, and strong mobile readability."
        : "TECHNICAL: Clean lines, professional shading/color treatment aligned with the selected style, clear panel borders, 12pt white gutters.";

  const styleIdentityToken = [
    `preset_id=${style.preset_id}`,
    `label=${style.preset_label}`,
    `render_mode=${style.render_mode}`
  ].join(" | ");

  const stylePriorityLines = [
    "STYLE PRIORITY (CRITICAL)",
    `- STYLE IDENTITY TOKEN: ${styleIdentityToken}`,
    "- Treat STYLE (BASE/USER ADDITION) as the single source of truth for visual rendering.",
    isKlingI2V
      ? "- Keep the selected visual style consistent across the full frame."
      : `- Keep the selected visual style consistent across all ${page.panels.length} panels.`,
    isStoryMode && !storyAntiEducationGuardEnabled
      ? ""
      : "- Do NOT apply generic fallback styles (especially clean educational webtoon) unless explicitly specified by STYLE.",
    "- Priority order: safety/text readability > selected style fidelity > extra decorative details.",
    isPureCinematic
      ? storyAntiEducationGuardEnabled
        ? "- Keep a premium cinematic visual tone; avoid flat explainer/classroom composition and didactic layout cues."
        : "- Keep a premium cinematic visual tone."
      : isWebtoonStyle
        ? "- Keep the chosen webtoon sub-style exactly (line quality, palette, shading method, texture level)."
        : "- This is NOT a webtoon-default request. Avoid clean webtoon shorthand unless STYLE explicitly asks for it.",
    isRealismStyle
      ? "- REALISM LOCK: Keep realistic camera/light/material behavior. Avoid anime/webtoon simplification."
      : "",
    negativeStylePrompt ? `- AVOID THESE STYLE TRAITS: ${negativeStylePrompt}` : "",
    isMangaStyle
      ? "- MANGA LOCK: Keep the selected manga sub-style (era, genre, line weight, screentone density, facial proportions, composition rhythm). Do not collapse it into generic clean webtoon."
      : "",
    shouldForceBlackAndWhiteManga
      ? "- BLACK-AND-WHITE MANGA LOCK: Render as monochrome ink art with screentones and hatching. Do NOT output full color."
      : "",
    shouldForceColorManga
      ? "- FULL COLOR LOCK: Render in full color only. Use rich vibrant palette and colored shading. Do NOT output grayscale/monochrome/black-and-white."
      : "",
    isMonochromeStyle
      ? "- MONOCHROME LOCK: Keep output black-and-white with screentones. Avoid full-color rendering."
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const i2vPanel = page.panels[0] || {
    scene: "",
    acting: "",
    camera: "",
    mood: ""
  };
  const structuralRequirementBlock = isWebtoonScrollSegment
    ? getWebtoonScrollChoreographyRules(page)
    : page.layout.template_id.startsWith("webtoon_")
      ? getWebtoonStructureRules(page)
    : `[Structural Requirement]
- EXACTLY ${page.panels.length} panels must be present on this single image.
- Follow the "${page.layout.template_id}" pattern described above.
- Ensure clear black frame lines separate each of the ${page.panels.length} scenes.`;
  const webtoonGeometryBlock = isWebtoon && !isWebtoonScrollSegment ? getWebtoonGeometryGuide(page) : "";
  const outputTypeLabel = isWebtoonScrollSegment
    ? `A Korean webtoon scroll segment (${WEBTOON_SCROLL_SEGMENT_CODEX_SIZE})`
    : isWebtoon
      ? "A single tall mobile webtoon page"
      : isManga
        ? "A single manga page (B5 format)"
        : "A single vertical comic page";
  const textPlacementRule = isWebtoonScrollSegment
    ? "5) NO OVERLAP: All text containers must remain readable and must not cover faces, key actions, or the next beat. For bubble_space beats, floating bubbles may sit in open whitespace without a panel border."
    : "5) NO OVERLAP: All text containers must stay strictly INSIDE their respective panel borders.";
  const textContainerContextRule = isWebtoonScrollSegment
    ? "8) SCROLL SEGMENT TEXT: Text may appear inside framed panels, borderless scenes, or open whitespace depending on the choreography. Do not invent extra panel boxes just to contain text."
    : "";
  const finalStructureCheck = isWebtoonScrollSegment
    ? "- Does it follow the scroll choreography instead of equal stacked boxes? Yes."
    : `- Does it have ${page.panels.length} distinct panels? Yes.`;
  const finalWhitespaceCheck = isWebtoonScrollSegment
    ? "- Are at least two beats visibly not ordinary boxed panels when choreography calls for pause/bubble/borderless/reaction space? Yes."
    : "";

  const comicPrompt = `${characterIdentityBlock}

────────────────────────────────────────
STYLE & COMPOSITION
────────────────────────────────────────
TYPE: ${outputTypeLabel}.
LAYOUT TYPE: ${layoutVisualGoal}
STYLE (BASE): ${effectiveStylePrompt}
${userStylePrompt ? `STYLE (USER ADDITION): ${userStylePrompt}` : ""}
${styleReferenceImage ? "STYLE REFERENCE: A style reference image is attached. Match its linework, palette, shading, and texture. This reference has higher priority than generic defaults. Do NOT copy logos, exact text, or identifiable faces from the reference." : ""}
${styleConsistencyImage ? "STYLE CONSISTENCY REFERENCE: A previously generated page is attached. Keep the same linework, coloring pipeline, and finish level for cross-page consistency." : ""}
${technicalInstruction}

${stylePriorityLines}

${toneNote}

${CONTENT_SAFETY_VISUAL_GUARD}

${structuralRequirementBlock}
${webtoonGeometryBlock ? `\n\n${webtoonGeometryBlock}` : ""}

────────────────────────────────────────
CONTENT & NARRATIVE
────────────────────────────────────────
PROTAGONIST (primary): ${charAppearance}
ROLE: ${charRole.toUpperCase()}
${roleNote}
${deliveryNote}
${supportingCastNote}
${characterConsistencyNote}
${productNote}

${isWebtoonScrollSegment ? scrollScriptMaterial : panelDescriptions}

────────────────────────────────────────
TEXT & BUBBLE RULES (CRITICAL)
────────────────────────────────────────
1) EXACT TEXT: Render the provided text lines EXACTLY (character-for-character). Do NOT paraphrase, rephrase, summarize, or "fix" endings.
2) THREE CONTAINER TYPES — use the correct visual container for each line as marked:
   • [SPEECH BUBBLE] → Standard speech bubble with a pointed tail toward the speaker. For spoken dialogue.
   • [THOUGHT CLOUD] → Cloud-shaped thought bubble with small circular tail (not a pointed tail). For inner monologue / unspoken thoughts. Visually DISTINCT from speech bubbles.
   • [NARRATION BOX] → Rectangular caption box (no tail), usually at the top or edge of the panel. For narrator exposition / scene-setting text.
3) NO SPEAKER NAMES: Do NOT include words like "주인공:", "나레이션:", "Name:" inside any container. Just the text content.
${bubbleLanguageRule}
${textPlacementRule}
${fontReadabilityRule}
7) CONTAINER DISTINCTION: Thought clouds and narration boxes must look VISUALLY DIFFERENT from speech bubbles. Do NOT render all text in identical speech bubbles.
${textContainerContextRule}

────────────────────────────────────────
SAFETY (REAL PEOPLE)
────────────────────────────────────────
- If any character refers to a real person, depict them as a stylized illustration and avoid an exact photoreal facial likeness.

────────────────────────────────────────
FINAL QUALITY CHECK
────────────────────────────────────────
- Is it ONE image? Yes.
${finalStructureCheck}
${finalWhitespaceCheck}
- Is the text prefix (Name:) removed? YES, ABSOLUTELY NO NAMES.
- Is selected style fidelity preserved without drifting to generic defaults? Yes.
${finalQualityLanguageCheck}
  `.trim();

  const i2vPrompt = `${characterIdentityBlock}

────────────────────────────────────────
KLING I2V FRAME BRIEF
────────────────────────────────────────
Use the uploaded image as the first frame; preserve character identity, outfit, style, and background.
TYPE: A single cinematic keyframe still for image-to-video.
ASPECT RATIO: ${i2vAspectRatio}
LAYOUT TYPE: ${layoutVisualGoal}

STYLE (BASE): ${effectiveStylePrompt}
${userStylePrompt ? `STYLE (USER ADDITION): ${userStylePrompt}` : ""}
${styleReferenceImage ? "STYLE REFERENCE: A style reference image is attached. Match its linework, palette, shading, and texture. Do NOT copy logos, exact text, or identifiable faces." : ""}
${styleConsistencyImage ? "STYLE CONSISTENCY REFERENCE: A previously generated frame is attached. Keep the same rendering pipeline and finish level." : ""}
${technicalInstruction}

${stylePriorityLines}

${toneNote}

${CONTENT_SAFETY_VISUAL_GUARD}

[FRAME CONTENT]
PROTAGONIST (primary): ${charAppearance}
ROLE: ${charRole.toUpperCase()}
${roleNote}
${deliveryNote}
${supportingCastNote}
${characterConsistencyNote}
${productNote}

Scene: ${i2vPanel.scene || "Describe a clear cinematic moment."}
Acting / Motion Intent: ${i2vPanel.acting || "Natural performance and motion-ready posture."}
Camera: ${i2vPanel.camera || "Eye-level"}
Mood: ${i2vPanel.mood || "Neutral"}

[TEXT RESTRICTIONS - CRITICAL]
- No subtitles, no captions, no on-screen text, no speech bubbles.
- No watermark, no logo, no UI overlay, no credits.
- The frame must be clean for voice-only dialogue in downstream i2v generation.
`.trim();

  const webtoonFormatBlock = isWebtoon ? `\n${getWebtoonFormatRules(page)}\n` : "";

  const mangaFormatBlock = isManga ? `
[MANGA FORMAT RULES]
- This is a traditional JAPANESE MANGA PAGE (B5 format).
- Reading order is RIGHT-TO-LEFT, TOP-TO-BOTTOM. Panel 1 is top-right, the last panel is bottom-left.
- Panel borders should be clean straight lines with VARIED THICKNESS for emphasis.
${mangaColorMode === "bw"
  ? "- MONOCHROME: Render in BLACK AND WHITE with screentone shading, crisp ink linework, hatching, and speed lines. NO color."
  : "- FULL COLOR MANGA: Render in vivid cel-shaded full color with clean ink outlines. Use vibrant palette and colored shading."}
- Use manga visual language: speed lines for motion, impact lines for emphasis, screentone gradients for mood.
- Dense panel composition — maximize the use of page space.
` : "";

  const fullPrompt = isKlingI2V
    ? i2vPrompt
    : (isWebtoon || isManga)
      ? `${comicPrompt}\n${webtoonFormatBlock}${mangaFormatBlock}`
      : comicPrompt;

  // === IMAGE ATTACHMENT ORDER ===
  // Priority: Text prompt → Character refs (highest) → Style refs → Product refs
  // Character references are placed first so the model gives them the most attention.
  const parts: any[] = [{ text: fullPrompt }];
  const referenceImages: string[] = [];
  const seenReferenceImages = new Set<string>();

  // --- Character reference images (HIGHEST PRIORITY) ---
  const MAX_CHARACTER_REF_IMAGES = 3;
  let charAttachedCount = 0;

  const attachCharRefImage = (label: string, dataUrl: string) => {
    if (charAttachedCount >= MAX_CHARACTER_REF_IMAGES) return;
    if (!dataUrl || !dataUrl.startsWith("data:")) return;
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return;
    if (!seenReferenceImages.has(dataUrl)) {
      seenReferenceImages.add(dataUrl);
      referenceImages.push(dataUrl);
    }
    parts.push({ text: label });
    parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
    charAttachedCount += 1;
  };

  const attachAnchorProtagonistRefs = () => {
    const mainRef = series.anchors.protagonist.reference_images.main;
    if (mainRef) attachCharRefImage("[PROTAGONIST REFERENCE IMAGE] Match this character exactly.", mainRef);
    for (const [idx, url] of (series.anchors.protagonist.reference_images.pack || []).entries()) {
      if (charAttachedCount >= MAX_CHARACTER_REF_IMAGES) break;
      if (url !== mainRef) {
        attachCharRefImage(`[PROTAGONIST REFERENCE IMAGE] #${idx + 1}`, url);
      }
    }
  };

  if (cast.length > 0) {
    const protagonists = cast.filter((c) => c?.role === "protagonist");
    const supporting = cast.filter((c) => c?.role !== "protagonist");

    for (const c of protagonists) {
      const name = String(c?.name || "").trim() || "Unnamed";
      const images = Array.isArray(c?.reference_images) ? c.reference_images : [];
      const seen = new Set<string>();
      for (let i = 0; i < images.length; i++) {
        if (seen.has(images[i])) continue;
        seen.add(images[i]);
        attachCharRefImage(`[PROTAGONIST REFERENCE IMAGE] ${name} — match this character exactly.`, images[i]);
        if (charAttachedCount >= MAX_CHARACTER_REF_IMAGES) break;
      }
      if (charAttachedCount >= MAX_CHARACTER_REF_IMAGES) break;
    }

    for (const c of supporting) {
      if (charAttachedCount >= MAX_CHARACTER_REF_IMAGES) break;
      const name = String(c?.name || "").trim() || "Unnamed";
      const images = Array.isArray(c?.reference_images) ? c.reference_images : [];
      if (images.length > 0) attachCharRefImage(`[CHARACTER REFERENCE IMAGE] ${name} (${c.role})`, images[0]);
    }
  } else {
    attachAnchorProtagonistRefs();
  }

  // --- Style reference images (after character refs) ---
  if (styleReferenceImage && styleReferenceImage.startsWith("data:")) {
    const parsed = parseDataUrl(styleReferenceImage);
    if (parsed) {
      if (!seenReferenceImages.has(styleReferenceImage)) {
        seenReferenceImages.add(styleReferenceImage);
        referenceImages.push(styleReferenceImage);
      }
      parts.push({ text: "[STYLE REFERENCE IMAGE] Prioritize linework, palette, shading, and texture from this image." });
      parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
    }
  }

  if (
    styleConsistencyImage &&
    styleConsistencyImage !== styleReferenceImage &&
    styleConsistencyImage.startsWith("data:")
  ) {
    const parsed = parseDataUrl(styleConsistencyImage);
    if (parsed) {
      if (!seenReferenceImages.has(styleConsistencyImage)) {
        seenReferenceImages.add(styleConsistencyImage);
        referenceImages.push(styleConsistencyImage);
      }
      parts.push({ text: "[STYLE CONSISTENCY REFERENCE IMAGE] Match this page's rendering pipeline and finish level for continuity." });
      parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
    }
  }

  // --- Product reference image (lowest priority) ---
  if (product && Array.isArray(product.reference_images)) {
    const label = String(product.label || "").trim() || "Product";
    const urls = product.reference_images.filter(Boolean);
    if (urls.length > 0 && urls[0].startsWith("data:")) {
      const parsed = parseDataUrl(urls[0]);
      if (parsed) {
        if (!seenReferenceImages.has(urls[0])) {
          seenReferenceImages.add(urls[0]);
          referenceImages.push(urls[0]);
        }
        parts.push({ text: `[PRODUCT REFERENCE IMAGE] ${label}` });
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
      }
    }
  }

  return {
    prompt: fullPrompt,
    referenceImages,
    imageProvider,
    codexImageModel,
    codexImageQuality,
    codexSize: isWebtoonScrollSegment
      ? WEBTOON_SCROLL_SEGMENT_CODEX_SIZE
      : resolveCodexImageSize(compatibleImageSize, resolvedAspectRatio)
  };
};

export const generateFullPageImage = async (
  series: SeriesSpec,
  page: PageSpec,
  imageSize: ImageSize,
  comicModeOverride?: ComicMode,
  options?: {
    styleConsistencyImage?: string | null;
    imageProvider?: ImageProvider;
    codexImageQuality?: CodexImageQuality;
    codexImageModel?: string;
  }
): Promise<string> => {
  const request = buildFullPageImageRequest(series, page, imageSize, comicModeOverride, options);

  try {
    const response = await postJson<{ image_data_url?: string | null }>("/api/codex/generate-image", {
      prompt: request.prompt,
      model: request.codexImageModel,
      size: request.codexSize,
      quality: request.codexImageQuality,
      moderation: "low",
      reference_images: request.referenceImages
    });
    if (typeof response.image_data_url === "string" && response.image_data_url.startsWith("data:")) {
      return response.image_data_url;
    }
    throw new Error("No image data");
  } catch (e) {
    console.error("Page gen failed", e);
    throw e;
  }
};

export const renderPanelPrompts = () => [];
export const detectCroppingIssue = async () => false;
export const generatePanelImage = async () => "";
