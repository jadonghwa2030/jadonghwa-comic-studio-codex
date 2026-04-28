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

export interface AnalyzePaperUrlParams {
  url: string;
  audience_level: AudienceLevel;
  detail_level: ScriptDetail;
  publication_format: PublicationFormat;
}

const paperStoryGuidance = `논문만화는 처음부터 "이 논문은 무엇을 해결합니다"라고 말하지 않습니다.
독자가 먼저 그 분야의 평범한 풍경을 보고, 그 안에서 작은 틈을 발견하고, 그 틈이 왜 연구 문제가 되는지 천천히 따라가게 만드세요.

paper_story_units는 논문에 맞게 줄이거나 합칠 수 있지만, 기본 흐름은 이렇게 잡습니다.
1. 원래 이 세계는 어떻게 굴러가고 있었나
2. 사람들은 무엇을 기대하고 있었나
3. 그런데 어디서 작은 틈이 보이나
4. 그 틈이 왜 그냥 넘길 수 없는 문제가 되나
5. 기존 방식은 어디까지 해냈고 어디서 막히나
6. 이 논문은 질문을 어떻게 다시 잡나
7. 어떤 아이디어나 방법을 꺼내나
8. 그걸 어떻게 확인했나
9. 결과는 무엇을 뜻하나
10. 어디까지 믿고, 무엇이 남나

각 paper_story_units 항목은 "이 페이지는 여기까지만"이라는 약속입니다.
reader_question, opening_scene, page_reveal, page_speech_flow, dont_explain_yet, allowed_content, forbidden_content, next_page_tease를 반드시 구분하세요.
allowed_content에는 그 페이지에서 실제로 말해도 되는 정보만 2~4개로 쓰세요.
forbidden_content에는 다음 페이지 이후로 넘겨야 하는 정보, 특히 방법/결과/기여/한계처럼 아직 이른 내용을 쓰세요.
next_page_tease는 페이지 끝의 작은 궁금증일 뿐입니다. 그 힌트 너머의 답을 같은 페이지에서 설명하지 마세요.
opening_scene은 말풍선 문장이 아니라, 실제로 그릴 수 있는 장면이어야 합니다.
opening_candidates도 첫 대사 후보가 아니라 장면의 씨앗으로 쓰세요. "오늘은", "~란", "왜 중요한지"로 시작하는 후보를 만들지 마세요.
첫 페이지는 임의의 비유 놀이로 시작하지 마세요. 논문에 없는 고양이 이야기, 상자, 창고, 버튼, 게임, 동화 같은 가짜 예시를 새로 만들지 말고, 논문이 실제로 다루는 분야의 사람, 자료, 도구, 화면, 현장을 보여주세요.
비유가 정말 필요하면, 그 비유가 무엇을 가리키는지 같은 페이지 안에서 바로 알 수 있어야 합니다. 독자가 "그래서 이게 무슨 논문 이야기지?"라고 느끼면 실패입니다.
page_suggestions는 논문 섹션 개수가 아니라, 독자가 편하게 따라갈 이해 단계 수와 정보 부담을 기준으로 잡으세요.`;

const paperBriefResponseJsonSchema = {
  type: "object",
  properties: {
    paper_title: { type: "string" },
    domain_guess: { type: "string" },
    paper_mode_track: { type: "string", enum: ["public_summary", "methodology_focus"] },
    one_line_takeaway: { type: "string" },
    motivation_context: { type: "string" },
    reader_hook_example: { type: "string" },
    opening_candidates: { type: "array", items: { type: "string" } },
    paper_story_units: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "string" },
          reader_question: { type: "string" },
          opening_scene: { type: "string" },
          page_reveal: { type: "string" },
          page_speech_flow: { type: "string" },
          dont_explain_yet: { type: "string" },
          allowed_content: { type: "array", items: { type: "string" } },
          forbidden_content: { type: "array", items: { type: "string" } },
          next_page_tease: { type: "string" },
          source_cue: { type: "string" }
        },
        required: ["step", "reader_question", "opening_scene", "page_reveal", "page_speech_flow", "dont_explain_yet", "allowed_content", "forbidden_content", "next_page_tease", "source_cue"],
        additionalProperties: false
      }
    },
    page_budget_note: { type: "string" },
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
    "opening_candidates",
    "paper_story_units",
    "page_budget_note",
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
};

const normalizePaperBrief = (json: any): PaperBrief => {
  const coerceStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const paperStoryUnits = Array.isArray(json.paper_story_units)
    ? json.paper_story_units
      .map((unit: any) => ({
        step: String(unit?.step || "").trim(),
        reader_question: String(unit?.reader_question || "").trim(),
        opening_scene: String(unit?.opening_scene || "").trim(),
        page_reveal: String(unit?.page_reveal || "").trim(),
        page_speech_flow: String(unit?.page_speech_flow || "").trim(),
        dont_explain_yet: String(unit?.dont_explain_yet || "").trim(),
        allowed_content: coerceStrings(unit?.allowed_content),
        forbidden_content: coerceStrings(unit?.forbidden_content),
        next_page_tease: String(unit?.next_page_tease || "").trim(),
        source_cue: String(unit?.source_cue || "").trim()
      }))
      .filter((unit: any) => unit.step || unit.reader_question || unit.opening_scene || unit.page_reveal)
    : [];

  return {
    ...json,
    opening_candidates: coerceStrings(json.opening_candidates),
    paper_story_units: paperStoryUnits,
    page_budget_note: String(json.page_budget_note || ""),
    source_cues: coerceStrings(json.source_cues),
    warnings: coerceStrings(json.warnings),
    prior_limitations: coerceStrings(json.prior_limitations),
    main_contributions: coerceStrings(json.main_contributions),
    limitations: coerceStrings(json.limitations),
    page_suggestions: {
      brief: Math.max(1, Math.floor(Number(json.page_suggestions?.brief || 1))),
      normal: Math.max(1, Math.floor(Number(json.page_suggestions?.normal || 2))),
      detailed: Math.max(1, Math.floor(Number(json.page_suggestions?.detailed || 3)))
    }
  } as PaperBrief;
};

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
${paperStoryGuidance}`
          }
        ]
      },
      config: {
        systemInstruction: "당신은 논문을 만화 설명용 브리프로 압축하는 연구 리서치 에디터입니다. 출력은 JSON만 반환하세요.",
        responseJsonSchema: paperBriefResponseJsonSchema
      }
    }
  });
  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  return normalizePaperBrief(json);
};

export const analyzePaperUrl = async (params: AnalyzePaperUrlParams): Promise<PaperBrief> => {
  const url = params.url.trim();
  const response = await postJson<{ text: string }>("/api/codex/generate-content", {
    request: {
      model: "gpt-5.5",
      contents: {
        parts: [
          {
            text: `아래 논문 URL을 조사해서 만화 플래너가 바로 사용할 수 있는 Paper Brief JSON을 만들어줘.

논문 URL: ${url}
독자 수준: ${params.audience_level}
상세도: ${params.detail_level}
출력 포맷: ${params.publication_format}

규칙:
- 반드시 이 URL과 검색으로 확인 가능한 논문 정보만 사용하세요.
- URL이 논문 페이지인지, PDF 원문 링크가 있는지, HTML 본문/초록/메타데이터만 접근 가능한지 확인하세요.
- PDF 원문 또는 본문 전체가 확인되지 않으면 방법/결과/한계를 과감히 단정하지 말고 warnings와 source_cues에 접근 한계를 적으세요.
- DOI/저널 랜딩/초록 페이지만 확인되는 경우에도 확인 가능한 범위에서 보수적인 Paper Brief를 만드세요.
- source_cues에는 사용한 URL, PDF 링크, 초록/본문/메타데이터 접근 상태를 짧게 남기세요.
${paperStoryGuidance}`
          }
        ]
      },
      config: {
        systemInstruction: "당신은 논문 URL을 조사해 만화 설명용 브리프로 압축하는 연구 리서치 에디터입니다. 출력은 JSON만 반환하세요.",
        responseJsonSchema: paperBriefResponseJsonSchema,
        tools: [{ googleSearch: {} }]
      }
    }
  });
  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  return normalizePaperBrief(json);
};
