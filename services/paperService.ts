import type { AudienceLevel, PaperBrief, PublicationFormat, ScriptDetail } from "../types";
import { postJson } from "./localApi";

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
        name: file.name || `paper_${Date.now()}.pdf`,
        mimeType: match[1] || file.type || "application/pdf",
        base64: match[2]
      });
    };
    reader.readAsDataURL(file);
  });
};

export interface AnalyzePaperPdfParams {
  file: File;
  audience_level: AudienceLevel;
  detail_level: ScriptDetail;
  publication_format: PublicationFormat;
}

export const analyzePaperPdf = async (params: AnalyzePaperPdfParams): Promise<PaperBrief> => {
  const filePayload = await fileToBase64(params.file);
  const response = await postJson<{ text: string }>("/api/codex/generate-content", {
    request: {
      model: "gpt-5.5",
      contents: {
        parts: [
          { inlineData: { mimeType: filePayload.mimeType, data: filePayload.base64, name: filePayload.name } },
          {
            text: `업로드된 논문 PDF를 읽고, 만화 플래너가 바로 사용할 수 있는 Paper Brief JSON을 만들어줘.

독자 수준: ${params.audience_level}
상세도: ${params.detail_level}
출력 포맷: ${params.publication_format}

규칙:
- PDF에서 확인되는 내용만 사용하세요.
- 불확실한 내용은 warnings/source_cues에 표시하세요.
- 논문 만화는 동기, 문제, 방법, 결과, 한계가 장면화되도록 정리하세요.`
          }
        ]
      },
      config: {
        systemInstruction: "당신은 논문을 만화 설명용 브리프로 압축하는 연구 리서치 에디터입니다. 출력은 JSON만 반환하세요.",
        responseJsonSchema: {
          type: "object",
          properties: {
            paper_title: { type: "string" },
            domain_guess: { type: "string" },
            paper_mode_track: { type: "string", enum: ["public_summary", "methodology_focus"] },
            one_line_takeaway: { type: "string" },
            motivation_context: { type: "string" },
            reader_hook_example: { type: "string" },
            core_problem: { type: "string" },
            research_question: { type: "string" },
            prior_limitations: { type: "array", items: { type: "string" } },
            main_contributions: { type: "array", items: { type: "string" } },
            method_summary: { type: "string" },
            result_summary: { type: "string" },
            limitations: { type: "array", items: { type: "string" } },
            source_cues: { type: "array", items: { type: "string" } },
            warnings: { type: "array", items: { type: "string" } },
            page_suggestions: {
              type: "object",
              properties: {
                brief: { type: "integer" },
                normal: { type: "integer" },
                detailed: { type: "integer" }
              },
              required: ["brief", "normal", "detailed"],
              additionalProperties: false
            }
          },
          required: [
            "paper_title",
            "domain_guess",
            "paper_mode_track",
            "one_line_takeaway",
            "motivation_context",
            "reader_hook_example",
            "core_problem",
            "research_question",
            "prior_limitations",
            "main_contributions",
            "method_summary",
            "result_summary",
            "limitations",
            "source_cues",
            "warnings",
            "page_suggestions"
          ],
          additionalProperties: false
        }
      }
    }
  });
  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  return {
    ...json,
    page_suggestions: {
      brief: Math.max(1, Math.floor(Number(json.page_suggestions?.brief || 1))),
      normal: Math.max(1, Math.floor(Number(json.page_suggestions?.normal || 2))),
      detailed: Math.max(1, Math.floor(Number(json.page_suggestions?.detailed || 3)))
    }
  } as PaperBrief;
};
