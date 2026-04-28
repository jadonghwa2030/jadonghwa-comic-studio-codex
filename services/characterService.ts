
import { CastRole, CharacterCandidate, CharacterSpec, ImageSize } from "../types";
import { parseDataUrl } from "./dataUrl";
import { normalizeGeminiImageSize } from "./geminiImageCompat";
import { postJson } from "./localApi";

export interface ContentCastSuggestion {
  role: CastRole;
  name: string;
  appearance: string;
  persona: string;
  catchphrase?: string;
  visual_prompt: string;
  story_function: string;
}

interface SelectedCharacterStyle {
  preset_id?: string;
  preset_label?: string;
  render_mode?: string;
  style_prompt?: string;
  user_style_prompt?: string | null;
}

const buildGenreEraLock = (sourceText: string): string => {
  const text = sourceText.toLowerCase();
  if (/(무협|무림|강호|문파|내공|단전|검법|검기|협객|사부|사형|사매|장문인|비급|객잔|도관|도사|마교|정파|사파)/i.test(text)) {
    return [
      "무협/강호 세계관으로 해석하세요.",
      "복장은 현대 정장/블레이저/넥타이/회사원 옷이 아니라, 동아시아 고전 무복, 도포, 장삼, 허리띠, 천 신발, 검집, 비녀/상투 등 시대에 맞는 요소를 사용하세요.",
      "머리, 소품, 실루엣도 현대 도시인이 아니라 무림 인물처럼 설계하세요."
    ].join(" ");
  }
  if (/(사극|조선|고려|왕궁|궁궐|왕세자|왕비|선비|한복|도포|상투|기생|장군|포졸|관아)/i.test(text)) {
    return "사극/전통 시대극 세계관으로 해석하세요. 현대 정장, 넥타이, 회사원 복장을 피하고 한복, 도포, 갑옷, 관복 등 시대 복식을 사용하세요.";
  }
  if (/(중세|기사|마법사|왕국|공작|후작|백작|검과 마법|드래곤|엘프|마탑|성기사)/i.test(text)) {
    return "중세/판타지 세계관으로 해석하세요. 현대 정장과 회사원 복장을 피하고 튜닉, 망토, 갑옷, 로브, 가죽 장비 등 장르 복식을 사용하세요.";
  }
  if (/(sf|sci-fi|우주|행성|사이버|로봇|안드로이드|우주선|미래도시)/i.test(text)) {
    return "SF/미래 세계관으로 해석하세요. 평범한 현대 정장보다 세계관에 맞는 미래형 유니폼, 기능성 재킷, 장비 실루엣을 우선하세요.";
  }
  return "자료에 드러난 시대, 장소, 장르 관습을 최우선으로 따르세요. 근거가 없으면 현대 정장/회사원 복장으로 기본값을 잡지 마세요.";
};

export const suggestCastFromContent = async (params: {
  source_text: string;
  creation_type: string;
  publication_format: string;
  audience_level?: string;
  source_label?: string;
  story_genre?: string;
  story_input_type?: string;
  age_rating?: string;
  pacing?: string;
  existing_cast?: CharacterSpec[];
  selected_style?: SelectedCharacterStyle;
}): Promise<ContentCastSuggestion[]> => {
  const sourceText = String(params.source_text || "").trim();
  if (!sourceText) return [];
  const genreEraLock = buildGenreEraLock(sourceText);
  const selectedStyle = params.selected_style || {};
  const selectedStyleSummary = [
    `프리셋: ${selectedStyle.preset_label || "unspecified"} (${selectedStyle.preset_id || "unknown"})`,
    `렌더 모드: ${selectedStyle.render_mode || "unspecified"}`,
    `그림체 지시: ${selectedStyle.style_prompt || "unspecified"}`,
    selectedStyle.user_style_prompt ? `사용자 추가 지시: ${selectedStyle.user_style_prompt}` : ""
  ].filter(Boolean).join("\n");

  const response = await postJson<{ text: string }>("/api/codex/generate-content", {
    request: {
      model: "gpt-5.5",
      contents: {
        parts: [{
          text: `다음 자료를 바탕으로 만화/웹툰 제작에 필요한 캐릭터 캐스트를 제안해줘.

제작 타입: ${params.creation_type}
출력 포맷: ${params.publication_format}
대상 독자: ${params.audience_level || "unspecified"}
자료 종류: ${params.source_label || "unspecified"}
스토리 장르: ${params.story_genre || "unspecified"}
스토리 입력 타입: ${params.story_input_type || "unspecified"}
연령 등급: ${params.age_rating || "unspecified"}
전개 속도: ${params.pacing || "unspecified"}
장르/시대 락: ${genreEraLock}

선택된 그림체:
${selectedStyleSummary}

기존 캐스트:
${(params.existing_cast || []).map((c) => `- ${c.role}: ${c.name || "(이름 없음)"} / ${c.appearance || "(외형 없음)"} / ${c.persona || "(설정 없음)"}`).join("\n") || "- 없음"}

자료:
${sourceText.slice(0, 60000)}
`
        }]
      },
      config: {
        systemInstruction: `당신은 만화 제작용 캐릭터 디렉터입니다.
- 자료 안에 실제로 등장하거나 강하게 암시된 인물만 뽑아 캐릭터 시트 초안을 만드세요.
- 이름이 없어도 "소녀", "노인", "검객", "어머니", "왕세자"처럼 원문 속 표현/행동/관계에서 확인되는 인물은 후보로 만들 수 있습니다.
- 단, 원문에 없는 독자 대리인, 안내자, 설명자, 관찰자, 개념 의인화, 대립 요소 같은 역할형 캐릭터를 새로 만들지 마세요.
- 학습만화 자료라도 실제 등장인물이 없는 설명문이면 억지 캐릭터를 만들지 말고 빈 characters 배열을 반환하세요.
- 스토리/웹툰이라면 원문의 주인공/조연/갈등 축을 우선하되, 반드시 원문 안에 근거가 있는 인물이어야 합니다.
- 원문 장르와 시대 복식을 최우선으로 유지하세요. 무협/사극/판타지/SF를 현대 회사원처럼 바꾸지 마세요.
- 선택된 그림체를 기준으로 appearance와 visual_prompt를 작성하세요. 캐릭터 디자인은 원문 근거와 시대/장르를 유지하되, 선화/채색/질감/렌더링 방향은 선택된 그림체와 잘 맞아야 합니다.
- render_mode가 photoreal이면 실사형 캐릭터 레퍼런스에 맞게, manga/webtoon/illustration 계열이면 해당 만화적 선화와 채색에 맞게 외형 문장을 조정하세요.
- 현대 정장, 블레이저, 넥타이, 오피스룩은 원문에 명시되어 있을 때만 사용하세요.
- 무협/강호/문파/내공/검법/객잔/도포 같은 단서가 있으면 반드시 무협 복식과 소품을 appearance와 visual_prompt에 넣으세요.
- role은 protagonist 또는 supporting만 사용하세요.
- protagonist는 1~2명, 전체 캐릭터는 1~6명으로 제한하세요.
- appearance는 이미지 생성에 바로 쓸 수 있게 얼굴/헤어/체형/의상/색상/시대복식 중심으로 구체화하세요.
- persona는 만화 속 기능, 관계, 말투를 포함하세요.
- visual_prompt는 복장과 세계관이 틀어지지 않도록 "무협 도포", "검집", "문파 제자복" 같은 장르 표지를 명시하세요.
- 출력은 JSON만 반환하세요.`,
        responseJsonSchema: {
          type: "object",
          properties: {
            characters: {
              type: "array",
              minItems: 0,
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  role: { type: "string", enum: ["protagonist", "supporting"] },
                  name: { type: "string" },
                  appearance: { type: "string" },
                  persona: { type: "string" },
                  catchphrase: { type: "string" },
                  visual_prompt: { type: "string" },
                  story_function: { type: "string" }
                },
                required: ["role", "name", "appearance", "persona", "visual_prompt", "story_function"],
                additionalProperties: false
              }
            }
          },
          required: ["characters"],
          additionalProperties: false
        }
      }
    }
  });

  const rawResponseText = String(response.text || "").trim();
  if (!rawResponseText) {
    throw new Error("Codex가 빈 응답을 반환했어. 로컬 API 로그에서 `/api/codex/generate-content` 실패 기록을 확인해줘.");
  }

  let json: any;
  try {
    json = JSON.parse(rawResponseText.match(/\{[\s\S]*\}/)?.[0] || rawResponseText);
  } catch {
    const preview = rawResponseText.slice(0, 500);
    throw new Error(`캐릭터 제안 응답을 JSON으로 읽지 못했어. 응답 일부: ${preview}`);
  }

  const rawCharacters = Array.isArray(json.characters) ? json.characters : [];
  const suggestions = rawCharacters
    .map((raw: any): ContentCastSuggestion | null => {
      const role: CastRole = raw?.role === "supporting" ? "supporting" : "protagonist";
      const name = String(raw?.name || "").trim();
      const appearance = String(raw?.appearance || raw?.visual_prompt || "").trim();
      const persona = String(raw?.persona || raw?.story_function || "").trim();
      const visualPrompt = String(raw?.visual_prompt || appearance).trim();
      const storyFunction = String(raw?.story_function || persona).trim();
      if (!name && !appearance && !persona) return null;
      return {
        role,
        name: name || (role === "protagonist" ? "주인공" : "조연"),
        appearance,
        persona,
        catchphrase: String(raw?.catchphrase || "").trim(),
        visual_prompt: visualPrompt,
        story_function: storyFunction
      };
    })
    .filter((item: ContentCastSuggestion | null): item is ContentCastSuggestion => Boolean(item));

  const protagonists = suggestions.filter((c) => c.role === "protagonist").slice(0, 2);
  const supporting = suggestions.filter((c) => c.role === "supporting").slice(0, 4);
  const normalized = protagonists.length > 0 ? [...protagonists, ...supporting] : suggestions.slice(0, 6);
  return normalized;
};

export const generateCharacterCandidates = async (
  description: string,
  imageSize: ImageSize = "1K",
  count: number = 4,
  options: {
    identityReferenceImages?: string[];
  } = {}
): Promise<CharacterCandidate[]> => {
  const compatibleImageSize = normalizeGeminiImageSize(imageSize, "character-generation");
  const identityReferenceImages = Array.isArray(options.identityReferenceImages)
    ? options.identityReferenceImages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 2)
    : [];
  const basePrompt = `
    Character Design Concept Art.
    Subject: ${description || "A friendly protagonist guide"}.
    Style: Professional character design sheet, clean lighting, high resolution, isolated on plain white background.
    Pose: Neutral standing pose, facing forward.
    Reference use: Attached images, if any, are CHARACTER IDENTITY references only. Preserve the person's/character's recognizable face shape, hair, body silhouette, outfit colors, and distinguishing marks, but ignore the original image's medium, linework, rendering style, lighting, color grading, lens look, or texture. The final rendering style must follow the Style direction in the subject description.
  `;

  const generateSingleCandidate = async (index: number): Promise<CharacterCandidate | null> => {
    try {
      const variedPrompt = `${basePrompt} \n (Variation ${index + 1})`;

      const response = await postJson<{ image_data_url?: string | null }>("/api/codex/generate-image", {
        prompt: variedPrompt,
        size: compatibleImageSize === "4K" ? "2048x2048" : compatibleImageSize === "2K" ? "2048x2048" : "1024x1024",
        quality: compatibleImageSize === "1K" ? "medium" : "high",
        moderation: "low",
        reference_images: identityReferenceImages.map((imageUrl, refIndex) => ({
          kind: "character_identity",
          label: `character identity reference ${refIndex + 1}`,
          image_url: imageUrl
        }))
      });

      if (typeof response.image_data_url === "string" && response.image_data_url.startsWith("data:")) {
        return {
          image_id: `cand_${Date.now()}_${index}`,
          preview_url: response.image_data_url
        };
      }
      return null;
    } catch (e) {
      console.warn(`Candidate ${index} gen failed`, e);
      return null;
    }
  };

  try {
    const promises = Array.from({ length: count }, (_, i) => generateSingleCandidate(i));
    const results = await Promise.all(promises);
    const validCandidates = results.filter((c): c is CharacterCandidate => c !== null);

    if (validCandidates.length === 0) {
      throw new Error("Failed to generate any candidates.");
    }

    return validCandidates;

  } catch (e) {
    console.warn("Character gen failed completely, using mock data", e);
    return Array(count).fill(0).map((_, i) => ({
      image_id: `mock_cand_${i}`,
      preview_url: `https://placehold.co/400x400/EEE/31343C?text=Candidate+${i+1}`
    }));
  }
};

export const generateStyleAlignedCharacterReference = async (params: {
  characterName?: string;
  identityProfile?: string;
  manualAppearance?: string;
  stylePrompt: string;
  userStylePrompt?: string | null;
  imageSize?: ImageSize;
  identityReferenceImages: string[];
}): Promise<string | null> => {
  const references = Array.isArray(params.identityReferenceImages)
    ? params.identityReferenceImages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 2)
    : [];
  if (references.length === 0) return null;

  const compatibleImageSize = normalizeGeminiImageSize(params.imageSize || "1K", "character-style-prepass");
  const prompt = [
    "Transform the attached character reference image into the selected drawing style.",
    "Keep the same person/character recognizable. Preserve facial structure, hair shape/color, body silhouette, outfit colors, accessories, and distinguishing marks.",
    "Do not redesign them as a new character. Do not change age, gender presentation, core facial identity, hairstyle, or key outfit details unless impossible.",
    "Remove the original photo/rendering look. Do not keep photographic lighting, lens blur, skin texture, realistic camera grain, or the source medium's finish.",
    `Selected style: ${params.stylePrompt}`,
    params.userStylePrompt ? `Style addition: ${params.userStylePrompt}` : "",
    `Character name: ${String(params.characterName || "").trim() || "unnamed"}`,
    `Identity profile: ${String(params.identityProfile || "").trim() || "use the attached reference"}`,
    `Manual appearance notes: ${String(params.manualAppearance || "").trim() || "none"}`,
    "Output a single clean character reference image in the selected style, no speech bubbles, no labels, no text, plain simple background."
  ].filter(Boolean).join("\n");

  const response = await postJson<{ image_data_url?: string | null }>("/api/codex/generate-image", {
    prompt,
    size: compatibleImageSize === "4K" ? "2048x2048" : compatibleImageSize === "2K" ? "2048x2048" : "1024x1024",
    quality: compatibleImageSize === "1K" ? "medium" : "high",
    moderation: "low",
    reference_images: references.map((imageUrl, refIndex) => ({
      kind: "character_identity",
      label: `style transfer source ${refIndex + 1}`,
      image_url: imageUrl
    }))
  });

  return typeof response.image_data_url === "string" && response.image_data_url.startsWith("data:")
    ? response.image_data_url
    : null;
};

export const buildAnchorPack = async (mainImageUrl: string): Promise<string[]> => {
  console.log("Building Anchor Pack for character...");
  return [mainImageUrl];
};

/**
 * Analyze a character reference image and extract structured appearance attributes.
 * Returns a structured description string for use in rendering prompts.
 */
export const analyzeCharacterImage = async (imageDataUrl: string): Promise<string | null> => {
  try {
    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) {
      console.warn("[analyzeCharacterImage] Could not parse data URL");
      return null;
    }

    const systemInstruction = `You are a character identity analyst for comic/illustration production.
**Goal:** Analyze the character in the image and return a JSON object describing only stable visual identity attributes.
**Rules:**
- Output MUST be a single valid JSON object. No markdown fences or extra text.
- Describe what you actually SEE, not what you assume.
- Extract identity only: face shape, eye/mouth impression, hair, body type, skin tone, outfit colors/silhouette, accessories, and distinguishing marks.
- Do NOT describe or preserve the source image's art medium, line quality, shading style, camera look, color grading, texture, 3D/photo/anime/webtoon style, artist style, or rendering finish.
- For illustrated/cartoon characters, translate stylized features into neutral anatomy/appearance terms instead of copying the illustration style.
- All string values should be concise (1-5 words each).`;

    const response = await postJson<{ text: string; candidates?: any[] }>("/api/codex/generate-content", {
      request: {
        model: "gpt-5.5",
        contents: {
          parts: [
            { inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } },
            { text: "Analyze this character image and extract their visual profile as JSON." }
          ]
        },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              gender: { type: "STRING", description: "male / female / ambiguous" },
              age_group: { type: "STRING", description: "child / teenager / 20s / 30s / 40s / 50s+ / ambiguous" },
              face_shape: { type: "STRING", description: "round / oval / angular / long / heart-shaped / etc." },
              eye_description: { type: "STRING", description: "concise identity-only eye impression, no art-style terms" },
              body_type: { type: "STRING", description: "slim / average / athletic / stocky / etc." },
              skin_tone: { type: "STRING", description: "fair / light / medium / tan / dark / etc." },
              hair_length: { type: "STRING", description: "bald / very short / short / medium / long / very long" },
              hair_style: { type: "STRING", description: "straight / wavy / curly / bob / ponytail / braids / etc." },
              hair_color: { type: "STRING", description: "black / brown / blonde / red / blue / pink / white / etc." },
              outfit_description: { type: "STRING", description: "Brief outfit description with colors and key items" },
              distinguishing_features: { type: "STRING", description: "Glasses, scars, accessories, unique traits, etc. Write 'none' if nothing notable." }
            },
            required: ["gender", "age_group", "face_shape", "eye_description", "body_type", "skin_tone", "hair_length", "hair_style", "hair_color", "outfit_description", "distinguishing_features"]
          }
        }
      }
    });

    const rawText = response.text?.trim() || response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) {
      console.warn("[analyzeCharacterImage] Empty response from Codex");
      return null;
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[analyzeCharacterImage] No JSON found in response:", rawText);
      return null;
    }

    const attrs = JSON.parse(jsonMatch[0]);

    const parts: string[] = [];
    if (attrs.gender && attrs.gender !== "ambiguous") parts.push(attrs.gender);
    if (attrs.age_group && attrs.age_group !== "ambiguous") parts.push(attrs.age_group);
    if (attrs.face_shape) parts.push(`${attrs.face_shape} face`);
    if (attrs.eye_description) parts.push(`${attrs.eye_description} eyes`);
    if (attrs.body_type) parts.push(`${attrs.body_type} build`);
    if (attrs.skin_tone) parts.push(`${attrs.skin_tone} skin`);
    if (attrs.hair_length && attrs.hair_style && attrs.hair_color) {
      parts.push(`${attrs.hair_length} ${attrs.hair_style} ${attrs.hair_color} hair`);
    }
    if (attrs.outfit_description) parts.push(`wearing ${attrs.outfit_description}`);
    if (attrs.distinguishing_features && attrs.distinguishing_features.toLowerCase() !== "none") {
      parts.push(attrs.distinguishing_features);
    }

    const result = parts.join(", ");
    console.log("[analyzeCharacterImage] Extracted:", result);
    return result || null;

  } catch (e) {
    console.warn("[analyzeCharacterImage] Analysis failed, will use manual description", e);
    return null;
  }
};
