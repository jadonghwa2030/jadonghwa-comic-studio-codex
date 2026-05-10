import {
  CharacterConsistencyMode,
  CharacterSpec,
  ComicMode,
  CreationType,
  I2VAspectRatio,
  MangaColorMode,
  NarrativeRole,
  PublicationFormat,
  SeriesSpec
} from "../types";

export interface SavedLongformProjectSnapshot {
  cast: CharacterSpec[];
  selectedPresetId: string;
  selectedStyleCategory: string;
  finalStyle: SeriesSpec["anchors"]["style"] | null;
  styleReferenceImage: string | null;
  creationType: CreationType;
  comicMode: ComicMode;
  publicationFormat: PublicationFormat;
  mangaColorMode: MangaColorMode;
  i2vAspectRatio: I2VAspectRatio;
  narrativeRole: NarrativeRole;
  characterConsistencyMode: CharacterConsistencyMode;
  useCrossPageStyleConsistency: boolean;
}

export interface SavedLongformProject {
  id: string;
  label: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
  snapshot: SavedLongformProjectSnapshot;
}

const STORAGE_KEY = "toon-for-codex.longform_projects.v1";

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

const asString = (value: unknown): string => typeof value === "string" ? value : "";

const sanitizeCharacter = (raw: any): CharacterSpec | null => {
  if (!raw || typeof raw !== "object") return null;
  const role = raw.role === "supporting" ? "supporting" : "protagonist";
  const id = asString(raw.id) || `lf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const refs = Array.isArray(raw.reference_images)
    ? raw.reference_images.map(asString).filter(Boolean)
    : [];
  const styleRefs = Array.isArray(raw.style_aligned_reference_images)
    ? raw.style_aligned_reference_images.map(asString).filter(Boolean)
    : [];

  return {
    id,
    role,
    name: asString(raw.name),
    appearance: asString(raw.appearance),
    analyzed_appearance: asString(raw.analyzed_appearance).trim() || undefined,
    persona: asString(raw.persona),
    catchphrase: asString(raw.catchphrase),
    catchphrase_frequency:
      raw.catchphrase_frequency === "often" || raw.catchphrase_frequency === "sometimes"
        ? raw.catchphrase_frequency
        : "rare",
    reference_images: refs,
    style_aligned_reference_images: styleRefs,
    style_aligned_reference_style_key: asString(raw.style_aligned_reference_style_key).trim() || undefined
  };
};

const sanitizeStyle = (raw: any): SeriesSpec["anchors"]["style"] | null => {
  if (!raw || typeof raw !== "object") return null;
  return {
    preset_id: asString(raw.preset_id),
    preset_label: asString(raw.preset_label),
    style_prompt: asString(raw.style_prompt),
    negative_style_prompt: asString(raw.negative_style_prompt),
    user_style_prompt: raw.user_style_prompt === null ? null : asString(raw.user_style_prompt),
    render_mode:
      raw.render_mode === "photoreal" || raw.render_mode === "mixed"
        ? raw.render_mode
        : "illustration",
    style_reference_image: raw.style_reference_image === null ? null : asString(raw.style_reference_image) || null
  };
};

const sanitizeSnapshot = (raw: any): SavedLongformProjectSnapshot | null => {
  if (!raw || typeof raw !== "object") return null;
  const cast = Array.isArray(raw.cast)
    ? raw.cast.map(sanitizeCharacter).filter((c): c is CharacterSpec => Boolean(c))
    : [];
  if (cast.length === 0) return null;

  return {
    cast,
    selectedPresetId: asString(raw.selectedPresetId) || "kwebtoon_clean_pastel",
    selectedStyleCategory: asString(raw.selectedStyleCategory) || "Webtoon",
    finalStyle: sanitizeStyle(raw.finalStyle),
    styleReferenceImage: asString(raw.styleReferenceImage) || null,
    creationType: raw.creationType === "paper" || raw.creationType === "educational" ? raw.creationType : "story",
    comicMode: asString(raw.comicMode) as ComicMode || "pure_cinematic",
    publicationFormat: asString(raw.publicationFormat) as PublicationFormat || "learning_comic",
    mangaColorMode: raw.mangaColorMode === "color" ? "color" : "bw",
    i2vAspectRatio:
      raw.i2vAspectRatio === "9:16" || raw.i2vAspectRatio === "1:1" ? raw.i2vAspectRatio : "16:9",
    narrativeRole: raw.narrativeRole === "narrator" ? "narrator" : "actor",
    characterConsistencyMode: raw.characterConsistencyMode === "loose" ? "loose" : "strict",
    useCrossPageStyleConsistency: raw.useCrossPageStyleConsistency === true
  };
};

const sanitizeProject = (raw: any): SavedLongformProject | null => {
  if (!raw || typeof raw !== "object") return null;
  const id = asString(raw.id);
  const label = asString(raw.label);
  const snapshot = sanitizeSnapshot(raw.snapshot);
  if (!id || !label || !snapshot) return null;
  const now = Date.now();
  return {
    id,
    label,
    created_at: asNumber(raw.created_at, now),
    updated_at: asNumber(raw.updated_at, now),
    last_opened_at: asNumber(raw.last_opened_at, now),
    snapshot
  };
};

export const loadLongformProjects = (): SavedLongformProject[] => {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeProject).filter((p): p is SavedLongformProject => Boolean(p));
  } catch {
    return [];
  }
};

export const persistLongformProjects = (projects: SavedLongformProject[]): void => {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (e) {
    console.warn("Failed to persist longform projects:", e);
  }
};
