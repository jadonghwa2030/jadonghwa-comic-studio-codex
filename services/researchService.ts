import { ComicMode, IntroStyle, NarrativeRole, QuestionType, ScriptDetail } from "../types";
import { postJson } from "./localApi";

export interface ResearchDigestResult {
  notes: string;
  page_suggestions: Record<ScriptDetail, number>;
  warnings: string[];
}

const fileToBase64 = (file: File): Promise<{ name: string; mimeType: string; base64: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const match = result.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        reject(new Error("Failed to encode file as base64."));
        return;
      }
      resolve({
        name: file.name || `research_${Date.now()}`,
        mimeType: match[1] || file.type || "application/octet-stream",
        base64: match[2]
      });
    };
    reader.readAsDataURL(file);
  });
};

export const analyzeResearchReport = async (params: {
  topic: string;
  question_type: QuestionType;
  comic_mode?: ComicMode;
  character_role: NarrativeRole;
  intro_style?: IntroStyle;
  report_text?: string;
  file?: File;
}): Promise<ResearchDigestResult> => {
  const filePayload = params.file ? await fileToBase64(params.file) : undefined;
  const response = await postJson<{ text: string }>("/api/codex/generate-content", {
    request: {
      model: "gpt-5.5",
      contents: {
        parts: [
          filePayload
            ? { inlineData: { mimeType: filePayload.mimeType, data: filePayload.base64, name: filePayload.name } }
            : null,
          {
            text: `다음 사용자 리서치 자료를 만화 플래너용 Mini Brief로 압축해줘.

주제: ${params.topic}
질문 유형: ${params.question_type}
만화 모드: ${params.comic_mode || "learning"}
주인공 역할: ${params.character_role}
도입 방식: ${params.intro_style || "standard"}

리서치 텍스트:
${String(params.report_text || "").slice(0, 60000)}
`
          }
        ].filter(Boolean)
      },
      config: {
        systemInstruction: `당신은 교육/스토리 만화 제작을 위한 리서치 다이제스트 편집자입니다.
- 입력 자료 밖의 사실을 만들지 마세요.
- 불확실한 항목은 UNKNOWN으로 표시하세요.
- 플래너가 바로 쓸 수 있게 장면화 가능한 정의/경계/예시/비유를 정리하세요.
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
