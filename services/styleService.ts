
import { MangaColorMode, PublicationFormat, StylePreset } from "../types";

const STYLE_PRESET_LABEL_EN: Record<string, string> = {
  kwebtoon_clean_pastel: "K-Webtoon · Clean Pastel",
  kwebtoon_vivid_pop: "K-Webtoon · Vivid Pop",
  kwebtoon_romfan_sparkle: "Romance Fantasy · Ornate",
  kwebtoon_murim_ink: "Martial Arts Webtoon · Ink Lines",
  kwebtoon_horror_webtoon: "Mystery Thriller · Pale",
  manga_screentone_bw: "B&W Manga · Screentone",
  american_comic_modern: "American Comics · Hero",
  kwebtoon_sports_energy: "Sports Webtoon · High Energy",
  kwebtoon_cyberpunk_light: "Cyberpunk · Neon Webtoon",
  kwebtoon_crayon_child: "Friendly Crayon · Childlike",
  kwebtoon_minimal_line: "Simple Labels · Minimal",
  kwebtoon_fantasy_watercolor: "Fantasy Watercolor Webtoon",
  noir_detective_comic: "Noir Comic · Dark",
  kwebtoon_retro_manhwa: "Classic Manhwa · Cheerful",
  kwebtoon_elegant_oil: "Painterly Webtoon · Oil",
  edu_textbook_inkwash: "Textbook Illustration · Ink & Watercolor",
  ghibli_fantasy_art: "Japanese Feature Animation · Painterly Fantasy",
  retro_90s_anime_cel: "90s Retro · Cel Anime",
  anime_modern_sky_light: "Modern Feature Anime · Youthful Light",
  anime_literary_drama_soft: "Sensitive Anime · Literary Drama",
  anime_dark_sword_fx: "Dark Action Anime · Sword FX",
  anime_graphic_pop_action: "Graphic Action Anime · Vivid",
  soft_slice_of_life: "Cozy Slice of Life · Warm",
  flat_infographic_modern: "Modern Infographic · Vector",
  pixel_art_retro: "Pixel Art · Retro Game",
  ill_pop_art: "Pop Art · Ben-Day Color",
  ill_charcoal_sketch: "Charcoal Drawing · Serious",
  ill_vintage_ad: "Vintage Ad · 50s Layout",
  ill_blueprint_tech: "Blueprint · Technical",
  ill_ukiyo_e: "Ukiyo-e · Classical Print",
  ill_technical_cutaway: "Technical · Cutaway",
  ill_felt_embroidery: "Felt Embroidery · Warm",
  ill_modern_ink_wash: "Modern Ink Wash · Abstract",
  paper_cutout_collage: "Paper Cutout · Collage",
  clay_stopmotion_look: "Clay Stop Motion · Handmade",
  isometric_3d_room: "Isometric 3D · Miniature",
  cinematic_3d_clean: "Feature 3D Animation · Studio",
  craft_low_poly: "Low Poly · Retro 3D",
  craft_glassmorphism: "Glassmorphism · Glass",
  craft_plastic_blocks: "Plastic Blocks · Buildable",
  craft_origami: "Origami · Folded Paper",
  craft_ceramic_pottery: "Ceramic Pottery · Glossy",
  craft_cardboard_world: "Cardboard World · Recycled",
  photoreal_edu_lifestyle: "Photoreal · Lifestyle",
  photoreal_edu_expedition: "Photoreal · Nature Documentary",
  photoreal_old_film: "Photoreal · Vintage Film",
  photoreal_cctv_security: "Photoreal · CCTV Scene",
  photoreal_macro_science: "Photoreal · Macro Science",
  photoreal_infrared_vision: "Photoreal · Thermal/Infrared",
  photoreal_edu_presenter: "Photoreal · Tech YouTuber",
  photoreal_underwater_ocean: "Photoreal · Underwater Exploration",
  photoreal_polaroid_instant: "Photoreal · Instant Film",
  photoreal_lab_scientific: "Photoreal · Science Lab",
  manga_80s_action: "80s Action Manga · Hardboiled",
  manga_80s_mecha: "80s Mecha · Real Robot",
  manga_90s_battle: "90s Battle Manga · Shonen Energy",
  manga_90s_shoujo: "90s Shojo · Magical Girl",
  manga_90s_horror: "90s Horror Manga · Psychological",
  manga_2000s_shonen: "2000s Shonen · Tactical Action",
  manga_2000s_romance: "2000s Shojo · School Romance",
  manga_2000s_seinen: "2000s Seinen · Suspense",
  manga_2000s_slice: "2000s Slice of Life · Comedy",
  manga_2010s_action: "2010s Action · Survival Fantasy",
  manga_2010s_fantasy: "2010s Isekai · RPG Fantasy",
  manga_2010s_sports: "2010s Sports · Team Match",
  manga_2010s_romance: "2010s Romance · Youthful",
  manga_2020s_action: "2020s Action · Supernatural Combat",
  manga_2020s_dark: "2020s Dark · Urban Grunge",
  manga_2020s_romance: "2020s Trendy · Idol Drama",
  manga_2020s_comedy: "2020s Comedy · Family Action",
  manga_chibi_sd: "Chibi/SD · Merch Anime",
  manga_josei_mature: "Josei · Fashion Romance",
  manga_shonen_classic: "Classic Shonen · Adventure"
};

export const getStylePresetDisplayLabel = (
  preset: Pick<StylePreset, "id" | "label">,
  uiLanguage: "ko" | "en" = "ko"
): string => {
  if (uiLanguage === "ko") return preset.label;
  return STYLE_PRESET_LABEL_EN[preset.id] || preset.label;
};

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
