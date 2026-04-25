
import { CharacterCandidate, ImageSize } from "../types";
import { parseDataUrl } from "./dataUrl";
import { normalizeGeminiImageSize } from "./geminiImageCompat";
import { postJson } from "./localApi";

export const generateCharacterCandidates = async (
  description: string,
  imageSize: ImageSize = "1K",
  count: number = 4
): Promise<CharacterCandidate[]> => {
  const compatibleImageSize = normalizeGeminiImageSize(imageSize, "character-generation");
  const basePrompt = `
    Character Design Concept Art.
    Subject: ${description || "A friendly protagonist guide"}.
    Style: Professional character design sheet, clean lighting, high resolution, isolated on plain white background.
    Pose: Neutral standing pose, facing forward.
  `;

  const generateSingleCandidate = async (index: number): Promise<CharacterCandidate | null> => {
    try {
      const variedPrompt = `${basePrompt} \n (Variation ${index + 1})`;

      const response = await postJson<{ image_data_url?: string | null }>("/api/codex/generate-image", {
        prompt: variedPrompt,
        size: compatibleImageSize === "4K" ? "2048x2048" : compatibleImageSize === "2K" ? "2048x2048" : "1024x1024",
        quality: compatibleImageSize === "1K" ? "medium" : "high",
        moderation: "low",
        reference_images: []
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

    const systemInstruction = `You are a character visual analyst for comic/illustration production.
**Goal:** Analyze the character in the image and return a JSON object describing their key visual attributes.
**Rules:**
- Output MUST be a single valid JSON object. No markdown fences or extra text.
- Describe what you actually SEE, not what you assume.
- For illustrated/cartoon characters, describe the art style features faithfully.
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
              body_type: { type: "STRING", description: "slim / average / athletic / stocky / etc." },
              skin_tone: { type: "STRING", description: "fair / light / medium / tan / dark / etc." },
              hair_length: { type: "STRING", description: "bald / very short / short / medium / long / very long" },
              hair_style: { type: "STRING", description: "straight / wavy / curly / bob / ponytail / braids / etc." },
              hair_color: { type: "STRING", description: "black / brown / blonde / red / blue / pink / white / etc." },
              outfit_description: { type: "STRING", description: "Brief outfit description with colors and key items" },
              distinguishing_features: { type: "STRING", description: "Glasses, scars, accessories, unique traits, etc. Write 'none' if nothing notable." }
            },
            required: ["gender", "age_group", "body_type", "skin_tone", "hair_length", "hair_style", "hair_color", "outfit_description", "distinguishing_features"]
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
