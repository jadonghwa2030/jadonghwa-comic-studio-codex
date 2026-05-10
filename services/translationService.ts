import { Type } from "./schemaTypes";
import { Language, PageSpec, SeriesSpec } from "../types";
import { generateGeminiContent } from "./textGenerationService";

const safeParseJson = (text: string) => {
  try {
    const jsonMatch = String(text || "").match(/\{[\s\S]*\}/);
    if (!jsonMatch) return JSON.parse(text);
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("JSON extraction failed in translationService:", text);
    throw e;
  }
};

const normalizeLanguageLabel = (lang: Language): string => (lang === "en" ? "English" : "Korean");
type DialoguePrefix = "" | "[thought]" | "[narration]";

const getDialoguePrefix = (value: string): DialoguePrefix => {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("[thought]")) return "[thought]";
  if (trimmed.startsWith("[narration]")) return "[narration]";
  return "";
};

const stripDialoguePrefix = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("[thought]")) return trimmed.slice("[thought]".length).trim();
  if (trimmed.startsWith("[narration]")) return trimmed.slice("[narration]".length).trim();
  return trimmed;
};

const restoreDialoguePrefix = (original: string, translated: unknown): string => {
  const originalText = String(original || "");
  const translatedText = String(translated || "").trim();
  const originalPrefix = getDialoguePrefix(originalText);
  const translatedBody = stripDialoguePrefix(translatedText);

  if (!originalPrefix) {
    return translatedText || originalText;
  }

  const body = translatedBody || stripDialoguePrefix(originalText);
  return body ? `${originalPrefix} ${body}` : originalPrefix;
};

export const translateSeriesPlan = async (params: {
  series_spec: SeriesSpec;
  pages: PageSpec[];
  to: Language;
}): Promise<{ series_spec: SeriesSpec; pages: PageSpec[] }> => {
  const from = params.series_spec?.series?.language || "ko";
  const to = params.to;
  if (from === to) return { series_spec: params.series_spec, pages: params.pages };
  const isKlingI2V = params.series_spec?.constraints?.output_mode === "kling_i2v";

  const payload = {
    series_title: String(params.series_spec?.series?.title || "").trim(),
    pages: params.pages.map((p) => ({
      page_index: p.page.index,
      chapter_title: String(p.page.chapter_title || ""),
      panels: p.panels.map((panel) => ({
        panel_index: panel.index,
        scene: String(panel.scene || ""),
        acting: String(panel.acting || ""),
        action_phase: String(panel.action_phase || ""),
        start_pose: String(panel.start_pose || ""),
        motion_continuation: String(panel.motion_continuation || ""),
        dialogues: Array.isArray(panel.dialogues) ? panel.dialogues.map((d) => String(d || "")) : [],
        camera: String(panel.camera || ""),
        mood: String(panel.mood || "")
      }))
    }))
  };

  const systemInstruction = `You are a careful localization/translation engine for an educational comic plan.

Rules (critical):
- Translate ONLY. Do not add, remove, merge, split, or reorder anything.
- Keep page_index and panel_index exactly the same.
- Keep the number of pages, panels, and dialogue lines exactly the same.
- Preserve meaning, technical terms, numbers, and proper nouns as faithfully as possible.
- If a dialogue line starts with [thought] or [narration], keep that exact prefix verbatim at the START of the translated line and translate only the remaining text.
- Do NOT invent, remove, or replace [thought]/[narration] prefixes.
${isKlingI2V
      ? '- Dialogues are voice lines for i2v. Preserve speaker labels if already present (e.g., "주인공: ..."). Translate start_pose and motion_continuation, but keep action_phase as one of the original enum values.'
      : '- Do NOT insert speaker names like "Narrator:" or "주인공:" into dialogues.'}
- Output must be a single JSON object that follows the provided schema (no markdown).`;

  const userPrompt = `Translate this comic plan JSON from ${normalizeLanguageLabel(from)} to ${normalizeLanguageLabel(to)}.

If a line is already in the target language, keep it as-is.

INPUT JSON:
${JSON.stringify(payload)}
`;

  const response = await generateGeminiContent<{ text: string }>({
      model: "gemini-3-pro-preview",
      contents: { parts: [{ text: userPrompt }] },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            series_title: { type: Type.STRING },
            pages: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  page_index: { type: Type.INTEGER },
                  chapter_title: { type: Type.STRING },
                  panels: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        panel_index: { type: Type.INTEGER },
                        scene: { type: Type.STRING },
                        acting: { type: Type.STRING },
                        action_phase: { type: Type.STRING },
                        start_pose: { type: Type.STRING },
                        motion_continuation: { type: Type.STRING },
                        dialogues: { type: Type.ARRAY, items: { type: Type.STRING } },
                        camera: { type: Type.STRING },
                        mood: { type: Type.STRING }
                      },
                      required: ["panel_index", "scene", "acting", "dialogues", "camera", "mood"]
                    }
                  }
                },
                required: ["page_index", "chapter_title", "panels"]
              }
            }
          },
          required: ["series_title", "pages"]
        }
      }
  });

  const data = safeParseJson(response.text) as any;
  const translatedPages = Array.isArray(data?.pages) ? data.pages : [];
  const translatedTitle = typeof data?.series_title === "string" ? data.series_title : "";

  const translatedByPageIndex = new Map<number, any>();
  for (const p of translatedPages) {
    const idx = Number(p?.page_index);
    if (Number.isFinite(idx)) translatedByPageIndex.set(idx, p);
  }

  const pages: PageSpec[] = params.pages.map((orig) => {
    const translated = translatedByPageIndex.get(orig.page.index);
    if (!translated) return orig;

    const translatedPanelsByIndex = new Map<number, any>();
    for (const panel of Array.isArray(translated.panels) ? translated.panels : []) {
      const idx = Number(panel?.panel_index);
      if (Number.isFinite(idx)) translatedPanelsByIndex.set(idx, panel);
    }

    return {
      ...orig,
      page: {
        ...orig.page,
        chapter_title: typeof translated.chapter_title === "string" ? translated.chapter_title : orig.page.chapter_title
      },
      panels: orig.panels.map((p) => {
        const t = translatedPanelsByIndex.get(p.index);
        if (!t) return p;
        return {
          ...p,
          scene: typeof t.scene === "string" ? t.scene : p.scene,
          acting: typeof t.acting === "string" ? t.acting : p.acting,
          action_phase: typeof t.action_phase === "string" ? t.action_phase : p.action_phase,
          start_pose: typeof t.start_pose === "string" ? t.start_pose : p.start_pose,
          motion_continuation: typeof t.motion_continuation === "string" ? t.motion_continuation : p.motion_continuation,
          dialogues: Array.isArray(t.dialogues)
            ? t.dialogues.map((d: any, index: number) => restoreDialoguePrefix(p.dialogues[index] || "", d))
            : p.dialogues,
          camera: typeof t.camera === "string" ? t.camera : p.camera,
          mood: typeof t.mood === "string" ? t.mood : p.mood
        };
      })
    };
  });

  const series_spec: SeriesSpec = {
    ...params.series_spec,
    series: {
      ...params.series_spec.series,
      language: to,
      title: translatedTitle.trim() || params.series_spec.series.title
    }
  };

  return { series_spec, pages };
};
