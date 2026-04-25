
import { MangaColorMode, PublicationFormat, StylePreset } from "../types";

const FULL_COLOR_MANGA_HINT =
  "full color manga, rich vibrant palette, no grayscale, no monochrome, no black-and-white page";
const BLACK_AND_WHITE_MANGA_HINT =
  "black-and-white manga page, monochrome ink linework, screentone shading, cross-hatching, no full color";

const isExplicitMonochromeStyle = (preset: StylePreset): boolean => {
  const idLabelProbe = `${preset.id} ${preset.label}`;
  return /(_bw|bw_|black.?white|monochrome|grayscale|흑백)/i.test(idLabelProbe);
};

const enforceColorMangaStylePrompt = (stylePrompt: string): string => {
  return String(stylePrompt || "")
    .replace(/high contrast black and white with occasional tone/gi, "high contrast full color with tone-like shading")
    .replace(/high contrast black and white/gi, "high contrast full color")
    .replace(/\bblack and white\b/gi, "full color")
    .replace(/\bblack-and-white\b/gi, "full-color");
};

const enforceBlackAndWhiteMangaStylePrompt = (stylePrompt: string): string => {
  return String(stylePrompt || "")
    .replace(/full color manga/gi, "black-and-white manga")
    .replace(/high contrast full color with tone-like shading/gi, "high contrast black and white with screentone shading")
    .replace(/high contrast full color/gi, "high contrast black and white")
    .replace(/rich vibrant palette/gi, "rich monochrome value range")
    .replace(/vibrant palette/gi, "monochrome value range")
    .replace(/vibrant colors/gi, "monochrome values")
    .replace(/colored shading/gi, "screentone shading")
    .replace(/full-color/gi, "black-and-white")
    .replace(/full color/gi, "black and white");
};

const mergePromptHints = (userPrompt: string, extraHint: string): string => {
  const base = String(userPrompt || "").trim();
  if (!extraHint) return base;
  if (!base) return extraHint;
  if (base.toLowerCase().includes(extraHint.toLowerCase())) return base;
  return `${base}, ${extraHint}`;
};

export const getStylePresets = async (): Promise<StylePreset[]> => {
  try {
    const response = await fetch('/style_presets.json');
    if (!response.ok) {
      throw new Error(`Failed to load styles: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching style presets:", error);
    // Fallback minimal style
    return [{
      id: "kwebtoon_clean_pastel",
      label: "기본 웹툰 스타일",
      render_mode: "illustration",
      style_prompt: "clean webtoon style, soft colors",
      negative_style_prompt: "blurry, messy",
      preview_hint: "기본 파스텔 스타일"
    }];
  }
};

export const selectStyle = (
  presets: StylePreset[], 
  presetId: string, 
  userStylePrompt: string | null = null,
  options: {
    publicationFormat?: PublicationFormat;
    mangaColorMode?: MangaColorMode;
  } = {}
) => {
  const preset = presets.find(p => p.id === presetId) || presets[0];
  if (!preset) throw new Error("No style presets available");

  const isMangaCategory = (preset.category || "") === "Manga";
  const isMangaFormatBw =
    options.publicationFormat === "manga" && (options.mangaColorMode || "bw") === "bw";
  const shouldForceBlackAndWhiteManga = isMangaCategory && isMangaFormatBw;
  const shouldForceColorManga =
    isMangaCategory && !isExplicitMonochromeStyle(preset) && !shouldForceBlackAndWhiteManga;
  const mergedUserStylePrompt = shouldForceBlackAndWhiteManga
    ? mergePromptHints(String(userStylePrompt || "").trim(), BLACK_AND_WHITE_MANGA_HINT)
    : shouldForceColorManga
    ? mergePromptHints(String(userStylePrompt || "").trim(), FULL_COLOR_MANGA_HINT)
    : String(userStylePrompt || "").trim();
  const finalStylePrompt = shouldForceBlackAndWhiteManga
    ? enforceBlackAndWhiteMangaStylePrompt(preset.style_prompt)
    : shouldForceColorManga
    ? enforceColorMangaStylePrompt(preset.style_prompt)
    : preset.style_prompt;

  return {
    preset_id: preset.id,
    preset_label: preset.label,
    style_prompt: finalStylePrompt,
    negative_style_prompt: preset.negative_style_prompt,
    user_style_prompt: mergedUserStylePrompt || null,
    render_mode: preset.render_mode
  };
};
