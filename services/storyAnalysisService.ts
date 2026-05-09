import { AgeRating, PacingPreference, PublicationFormat, ScriptDetail, StoryGenre, StoryInputType } from "../types";
import { generateGeminiContent } from "./textGenerationService";

export interface StoryAnalysisResult {
  notes: string;
  page_suggestions: Record<ScriptDetail, number>;
  warnings: string[];
}

export const analyzeStoryScript = async (params: {
  script_text: string;
  story_input_type: StoryInputType;
  genre?: StoryGenre;
  pacing?: PacingPreference;
  age_rating: AgeRating;
  publication_format: PublicationFormat;
}): Promise<StoryAnalysisResult> => {
  const response = await generateGeminiContent<{ text: string }>({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{
          text: `다음 텍스트를 만화 각색용 Story Brief로 분석해줘.

입력 타입: ${params.story_input_type}
장르: ${params.genre || "unspecified"}
전개 속도: ${params.pacing || "balanced"}
연령 등급: ${params.age_rating}
출력 포맷: ${params.publication_format}

원문:
${params.script_text.slice(0, 60000)}
`
        }]
      },
      config: {
        systemInstruction: `당신은 만화 각색을 위한 스토리 다이제스트 편집자입니다.
- 원문을 임의로 확장하지 말고, 만화 플래너가 바로 쓸 수 있는 핵심 사건/인물/갈등/톤을 정리하세요.
- 페이지 수 제안은 brief/normal/detailed 각각 정수로 제시하세요.
- 출력은 JSON만 반환하세요.`,
        responseJsonSchema: {
          type: "object",
          properties: {
            notes: { type: "string" },
            page_suggestions: {
              type: "object",
              properties: {
                brief: { type: "integer" },
                normal: { type: "integer" },
                detailed: { type: "integer" }
              },
              required: ["brief", "normal", "detailed"],
              additionalProperties: false
            },
            warnings: { type: "array", items: { type: "string" } }
          },
          required: ["notes", "page_suggestions", "warnings"],
          additionalProperties: false
        }
      }
  });
  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  return {
    notes: String(json.notes || ""),
    page_suggestions: {
      brief: Math.max(1, Math.floor(Number(json.page_suggestions?.brief || 1))),
      normal: Math.max(1, Math.floor(Number(json.page_suggestions?.normal || 2))),
      detailed: Math.max(1, Math.floor(Number(json.page_suggestions?.detailed || 3)))
    },
    warnings: Array.isArray(json.warnings) ? json.warnings.map((w: unknown) => String(w)).filter(Boolean) : []
  };
};
