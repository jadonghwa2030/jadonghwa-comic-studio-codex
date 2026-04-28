import { PublicationFormat, LayoutTemplate } from "../types";

export type DisplayMode = "paginated" | "scroll" | "paginated_rtl";
export type FormatColorMode = "color" | "bw" | "any";

export interface FormatConfig {
  id: PublicationFormat;
  label: string;
  labelKo: string;
  description: string;
  descriptionKo: string;
  panelsPerPage: number;
  canvasSize: { w: number; h: number };
  aspectRatioHint: string;
  readingDirection: "ltr" | "rtl";
  colorMode: FormatColorMode;
  templatePrefix: string;
  unitLabel: "PAGE" | "FRAME" | "STRIP";
  unitLabelKo: string;
  displayMode: DisplayMode;
  gutterPx: number;
  borderPx: number;
  borderRadiusPx: number;
  backgroundColor: string;
}

export const FORMAT_CONFIGS: Record<PublicationFormat, FormatConfig> = {
  learning_comic: {
    id: "learning_comic",
    label: "Learning Comic",
    labelKo: "학습만화",
    description: "4-panel educational comic pages",
    descriptionKo: "한 페이지당 4컷 학습만화를 생성합니다.",
    panelsPerPage: 4,
    canvasSize: { w: 800, h: 1200 },
    aspectRatioHint: "2:3",
    readingDirection: "ltr",
    colorMode: "any",
    templatePrefix: "",
    unitLabel: "PAGE",
    unitLabelKo: "페이지",
    displayMode: "paginated",
    gutterPx: 12,
    borderPx: 4,
    borderRadiusPx: 16,
    backgroundColor: "#FFFFFF",
  },
  webtoon: {
    id: "webtoon",
    label: "Korean Webtoon",
    labelKo: "웹툰",
    description: "Mobile-first webtoon pages",
    descriptionKo: "모바일 친화형 웹툰 페이지를 생성합니다.",
    panelsPerPage: 3,
    canvasSize: { w: 800, h: 1422 },
    aspectRatioHint: "9:16",
    readingDirection: "ltr",
    colorMode: "color",
    templatePrefix: "webtoon_",
    unitLabel: "STRIP",
    unitLabelKo: "스트립",
    displayMode: "scroll",
    gutterPx: 0,
    borderPx: 0,
    borderRadiusPx: 0,
    backgroundColor: "#FFFFFF",
  },
  manga: {
    id: "manga",
    label: "Japanese Manga",
    labelKo: "만화 (Manga)",
    description: "Traditional manga pages with dense panel layouts",
    descriptionKo: "일본 만화 페이지를 생성합니다. 오른쪽→왼쪽 읽기, 5~6컷.",
    panelsPerPage: 6,
    canvasSize: { w: 728, h: 1032 },
    aspectRatioHint: "3:4",
    readingDirection: "rtl",
    colorMode: "any",
    templatePrefix: "manga_",
    unitLabel: "PAGE",
    unitLabelKo: "ページ",
    displayMode: "paginated_rtl",
    gutterPx: 6,
    borderPx: 3,
    borderRadiusPx: 0,
    backgroundColor: "#FFFFFF",
  },
  kling_i2v: {
    id: "kling_i2v",
    label: "I2V (Kling)",
    labelKo: "I2V 프레임",
    description: "Single-frame keyframes for I2V pipeline",
    descriptionKo: "I2V 영상 생성용 키프레임을 생성합니다.",
    panelsPerPage: 1,
    canvasSize: { w: 1600, h: 900 },
    aspectRatioHint: "16:9",
    readingDirection: "ltr",
    colorMode: "any",
    templatePrefix: "i2v_",
    unitLabel: "FRAME",
    unitLabelKo: "프레임",
    displayMode: "paginated",
    gutterPx: 0,
    borderPx: 0,
    borderRadiusPx: 0,
    backgroundColor: "#000000",
  },
};

/**
 * Learning-comic template catalog.
 * Non-pro UI paths filter this back to 4-panel templates; Pro may use the 3-7 panel templates.
 */
const LEGACY_LEARNING_TEMPLATE_IDS = [
  "classic_grid",
  "hero_top",
  "hero_bottom",
  "diagonal_split_v1",
  "inset_focus",
  "masonry_alt",
  "wide_strips",
  "triptych_hero",
  "sandwich",
  "diagonal_v2",
  "quad_asymmetric",
  "inset_strip",
  "cinematic_definition_3",
  "impact_reveal_3",
  "debate_collision_5",
  "misconception_crack_5",
  "investigation_board_7",
  "quiz_tension_6",
  "myth_fact_split_5",
  "timeline_burst_6",
  "cause_effect_chain_6",
  "process_cutaway_6",
  "zoom_cascade_5",
  "experiment_failure_7",
] as const;

/** 웹툰 동적 레이아웃 제약 조건 (단일 9:16 페이지 기준) */
export const WEBTOON_DYNAMIC_CONSTRAINTS = {
  canvasWidth: 800,
  minPanels: 2,
  maxPanels: 5,
  minHeightWeight: 1,
  maxHeightWeight: 5,
  baseCanvasHeight: 1422,
  minCanvasHeight: 1422,
  maxCanvasHeight: 1422,
  gapFraction: 0.03,
  topMargin: 0.02,
  bottomMargin: 0.02,
  sceneTypeDefaults: {
    dialogue: 2,
    action: 4,
    emotional: 3,
    establishing: 3,
    transition: 1,
    impact: 5,
    closeup: 2,
  } as Record<string, number>,
};

export const getFormatConfig = (format: PublicationFormat): FormatConfig =>
  FORMAT_CONFIGS[format] || FORMAT_CONFIGS.learning_comic;

export const getTemplatesForFormat = (
  format: PublicationFormat,
  allTemplates: LayoutTemplate[]
): LayoutTemplate[] => {
  const config = getFormatConfig(format);
  if (format === "learning_comic") {
    const byId = new Map(allTemplates.map((t) => [t.id, t] as const));
    const legacySet = LEGACY_LEARNING_TEMPLATE_IDS
      .map((id) => byId.get(id))
      .filter((t): t is LayoutTemplate => Boolean(t));
    if (legacySet.length > 0) return legacySet;

    return allTemplates.filter(
      (t) => t.panels.length === 4 && !t.id.startsWith("webtoon_") && !t.id.startsWith("manga_")
    );
  }
  if (format === "kling_i2v") {
    return allTemplates.filter((t) => t.id.startsWith("i2v_"));
  }
  return allTemplates.filter((t) => t.id.startsWith(config.templatePrefix));
};

export const getPanelsPerPage = (format: PublicationFormat): number =>
  getFormatConfig(format).panelsPerPage;

export const getUnitLabel = (format: PublicationFormat): string =>
  getFormatConfig(format).unitLabel;

export const getUnitLabelKo = (format: PublicationFormat): string =>
  getFormatConfig(format).unitLabelKo;

export const getDisplayMode = (format: PublicationFormat): DisplayMode =>
  getFormatConfig(format).displayMode;

export const isKlingI2V = (format: PublicationFormat): boolean =>
  format === "kling_i2v";

export const isWebtoon = (format: PublicationFormat): boolean =>
  format === "webtoon";

export const isManga = (format: PublicationFormat): boolean =>
  format === "manga";

export const isLearningComic = (format: PublicationFormat): boolean =>
  format === "learning_comic";

/** Convert legacy OutputMode to PublicationFormat */
export const migrateOutputMode = (outputMode?: string): PublicationFormat => {
  if (outputMode === "kling_i2v") return "kling_i2v";
  return "learning_comic";
};
