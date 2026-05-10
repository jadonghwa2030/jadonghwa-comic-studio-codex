import type { ScriptDetail } from "../types";
import { generateGeminiContent } from "./textGenerationService";

export interface NarrativePageSuggestionResult {
  page_suggestions: Record<ScriptDetail, number>;
  page_division_note: string;
}

const estimateMinimumPageSuggestions = (text: string): Record<ScriptDetail, number> => {
  const normalized = String(text || "").trim();
  const nonSpaceChars = normalized.replace(/\s/g, "").length;
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20).length;
  const sentenceLikeBreaks = normalized
    .split(/[.!?。！？]\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 30).length;
  const learningBeats = Math.max(paragraphs, Math.ceil(sentenceLikeBreaks / 2));

  return {
    brief: Math.max(1, Math.ceil(learningBeats / 3), Math.ceil(nonSpaceChars / 1800)),
    normal: Math.max(2, Math.ceil(learningBeats / 2), Math.ceil(nonSpaceChars / 1200)),
    detailed: Math.max(3, Math.ceil(learningBeats * 0.75), Math.ceil(nonSpaceChars / 800))
  };
};

export const suggestNarrativePageCounts = async (params: {
  narrative_text: string;
  subject?: string;
}): Promise<NarrativePageSuggestionResult> => {
  const narrative = String(params.narrative_text || "").trim();
  if (!narrative) {
    return {
      page_suggestions: { brief: 1, normal: 2, detailed: 3 },
      page_division_note: ""
    };
  }

  const response = await generateGeminiContent<{ text: string }>({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{
          text: `다음 원고를 만화 페이지로 나누려 한다.

주제: ${String(params.subject || "").trim() || "unspecified"}
원고 길이 참고:
- 공백 제외 글자 수: ${narrative.replace(/\s/g, "").length}
- 문단 수: ${narrative.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean).length}

원고:
${narrative.slice(0, 60000)}
`
        }]
      },
      config: {
        systemInstruction: `당신은 만화 편집자입니다.
- 원고를 다시 요약하거나 새로 쓰지 마세요.
- 원고의 장면 전환, 질문 전환, 정보 부담만 보고 페이지 수를 추천하세요.
- brief/normal/detailed는 모두 1 이상의 정수여야 합니다.
- page_division_note는 왜 그 페이지 수가 맞는지, 줄이면 어디가 합쳐지고 늘리면 무엇이 살아나는지 2~4문장으로만 설명하세요.
- 출력은 JSON만 반환하세요.`,
        responseJsonSchema: {
          type: "object",
          properties: {
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
            page_division_note: { type: "string" }
          },
          required: ["page_suggestions", "page_division_note"],
          additionalProperties: false
        }
      }
  });

  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  const minimums = estimateMinimumPageSuggestions(narrative);
  return {
    page_suggestions: {
      brief: Math.max(minimums.brief, Math.floor(Number(json.page_suggestions?.brief || 1))),
      normal: Math.max(minimums.normal, Math.floor(Number(json.page_suggestions?.normal || 2))),
      detailed: Math.max(minimums.detailed, Math.floor(Number(json.page_suggestions?.detailed || 3)))
    },
    page_division_note: String(json.page_division_note || "").trim()
  };
};
