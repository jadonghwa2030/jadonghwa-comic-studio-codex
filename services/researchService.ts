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
- 플래너가 바로 쓸 수 있게 자료를 정보 요약서가 아니라 학습 전개 설계서로 압축하세요.
- notes에는 [LEARNING STORY], [OPENING CANDIDATES], [LEARNING UNITS], [PAGE BUDGET], [KEY POINTS], [DEFINITIONS], [UNKNOWN] 섹션을 포함하세요.
- [LEARNING STORY]에는 "처음 보이는 장면 → 독자가 품을 질문 → 이름을 붙이는 순간 → 직접 확인/비교 → 작은 정리" 흐름을 4~6줄로 적으세요.
- [OPENING CANDIDATES]에는 정의문이 아닌 오프닝 장면 2~3개를 적으세요.
- [LEARNING UNITS]의 각 unit은 한 페이지가 담당할 수 있는 학습 행동 1개입니다. 각 unit에는 reader_question, opening_scene, page_reveal, dont_explain_yet를 짧게 포함하세요.
- 교육 만화/학습만화의 [FRAMING]은 되도록 만들지 말고, 필요하면 [LEARNING STORY] 안에 흡수하세요. "첫 장면은 정의로 바로 시작", "첫 말풍선은 ○○란..."처럼 정의문 오프닝을 강제하지 마세요.
- 첫 unit은 보통 정의가 아니라 독자가 볼 수 있는 상황, 대비, 궁금증, 작은 문제에서 시작하세요. 이름 붙이기/정의는 궁금증이 생긴 뒤에 배치하세요.
- 페이지 수 제안은 정보 항목 수가 아니라 학습 행동 수와 학습 부담을 기준으로 잡으세요.
- normal은 한 페이지에 한 가지 학습 행동만 자연스럽게 담을 수 있는 분량이어야 합니다. 정의/뜻/상황/예문/주의점/요약이 한 페이지에 3개 이상 몰리면 페이지를 늘리세요.
- brief도 말풍선이 빽빽해질 정도로 과소 산정하지 마세요.
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
