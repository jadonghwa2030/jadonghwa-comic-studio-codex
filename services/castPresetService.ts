import { CastRole, CatchphraseFrequency, NarrativeRole } from "../types";

export interface CastPresetCharacter {
  role: CastRole;
  name: string;
  appearance: string;
  persona?: string;
  catchphrase?: string;
  catchphrase_frequency?: CatchphraseFrequency;
}

export interface CastPresetPayload {
  narrativeRole: NarrativeRole;
  cast: CastPresetCharacter[];
}

export interface CastPreset {
  id: string;
  label: string;
  created_at: number;
  updated_at: number;
  payload: CastPresetPayload;
}

const STORAGE_KEY = "toon-for-codex.cast_presets.v1";

const hasLocalStorage = (): boolean => {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
};

const isCastRole = (v: unknown): v is CastRole => v === "protagonist" || v === "supporting";
const isNarrativeRole = (v: unknown): v is NarrativeRole => v === "narrator" || v === "actor";
const isCatchphraseFrequency = (v: unknown): v is CatchphraseFrequency => v === "rare" || v === "sometimes" || v === "often";

const sanitizeCharacter = (raw: any): CastPresetCharacter | null => {
  if (!raw || typeof raw !== "object") return null;
  if (!isCastRole(raw.role)) return null;
  return {
    role: raw.role,
    name: String(raw.name ?? ""),
    appearance: String(raw.appearance ?? ""),
    persona: typeof raw.persona === "string" ? raw.persona : undefined,
    catchphrase: typeof raw.catchphrase === "string" ? raw.catchphrase : undefined,
    catchphrase_frequency: isCatchphraseFrequency(raw.catchphrase_frequency) ? raw.catchphrase_frequency : undefined
  };
};

const sanitizePreset = (raw: any): CastPreset | null => {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  const created_at = Number(raw.created_at);
  const updated_at = Number(raw.updated_at);
  if (!Number.isFinite(created_at) || !Number.isFinite(updated_at)) return null;
  const payload = raw.payload;
  if (!payload || typeof payload !== "object") return null;
  if (!isNarrativeRole(payload.narrativeRole)) return null;
  const castRaw = Array.isArray(payload.cast) ? payload.cast : [];
  const cast = castRaw.map(sanitizeCharacter).filter((c): c is CastPresetCharacter => Boolean(c));

  return {
    id: raw.id,
    label: raw.label,
    created_at,
    updated_at,
    payload: { narrativeRole: payload.narrativeRole, cast }
  };
};

export const loadCastPresets = (): CastPreset[] => {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePreset).filter((p): p is CastPreset => Boolean(p));
  } catch {
    return [];
  }
};

export const persistCastPresets = (presets: CastPreset[]): void => {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn("Failed to persist cast presets:", e);
  }
};
