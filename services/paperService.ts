import type { AudienceLevel, PaperBrief, PublicationFormat, ScriptDetail } from "../types";
import { generateGeminiContent } from "./textGenerationService";

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
먼저 문외한도 들어올 수 있는 비유 세계, 사건 장면, 또는 현장 풍경으로 시작하세요.
독자가 "무슨 말이지?"가 아니라 "어, 왜 이런 일이 생기지?"라고 느낀 뒤에야 논문의 핵심 개념을 등장시키세요.

explainer_story는 이 분석의 가장 중요한 산출물입니다.
- 논문을 바로 요약하지 말고, 소설처럼 쉽게 읽히는 해설 원고로 쓰세요.
- 이 원고는 뒤 단계로 거의 그대로 전달됩니다. 다음 단계용 메모를 따로 만든다고 생각하지 말고, 처음부터 만화의 원작 해설 원고처럼 쓰세요.
- 첫 단락은 한 줄 핵심 요약이 아니라 장면/세계관/비유/사건으로 시작하세요.
- 비유와 장면화는 설명용이라는 점을 유지하되, 논문 팩트와 충돌하거나 근거 없는 결론을 만들지 마세요.
- 어려운 용어는 독자가 필요성을 느낀 뒤 이름 붙이듯 소개하세요.
- 만화 플래너가 이 원고를 원문처럼 나눠 쓸 수 있게, 장면 전환과 질문의 흐름을 살려 쓰세요.
- 문단형 설명 리포트처럼 정리하지 마세요. 문단마다 하나의 장면 전환이나 질문 전환이 살아 있어야 합니다.
첫 페이지는 한 줄 핵심 요약이나 정의문으로 시작하지 마세요.
비유/세계관을 쓰되, 논문의 실제 주제와 연결되는 장면이어야 합니다. 독자가 "재미는 있는데 그래서 무슨 논문이지?"라고 느끼면 실패입니다.
초반부터 논문 제목, 발표일, 벤치마크, 모델명, 점수표를 해설자처럼 몰아넣지 마세요. 그런 정보는 이야기가 충분히 깔린 뒤 꼭 필요할 때만 자연스럽게 등장시키세요.`;

const paperReceptionGuidance = `public_reception_notes는 만화 마지막에 붙일 "리뷰와 대중 반응" 에필로그 재료입니다.
- 논문 자체의 결론처럼 쓰지 말고, "이런 반응이 있었다" 정도의 관찰로만 쓰세요.
- 공식 리뷰/학회 토론/저자 코멘트/뉴스레터/블로그/X/Reddit 등 공개적으로 확인 가능한 반응만 사용하세요.
- 직접 인용문을 길게 옮기지 말고, 짧은 요약으로 정리하세요.
- 반응 출처의 성격을 함께 적으세요. 예: "학계/전문가 쪽에서는 ...", "커뮤니티에서는 ..."
- 확인 가능한 외부 반응이 부족하면 억지로 만들지 말고 빈 배열로 두고 warnings에 남기세요.`;

const paperBriefResponseJsonSchema = {
  type: "object",
  properties: {
    paper_title: { type: "string" },
    explainer_story: { type: "string" },
    public_reception_notes: { type: "array", items: { type: "string" } },
    source_cues: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: [
    "paper_title",
    "explainer_story",
    "public_reception_notes",
    "source_cues",
    "warnings"
  ],
  additionalProperties: false
};

const normalizePaperBrief = (json: any): PaperBrief => {
  const coerceStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];

  return {
    paper_title: String(json.paper_title || ""),
    domain_guess: "",
    paper_mode_track: "public_summary",
    one_line_takeaway: "",
    explainer_story: String(json.explainer_story || ""),
    page_division_note: "",
    motivation_context: "",
    reader_hook_example: "",
    core_problem: "",
    research_question: "",
    prior_limitations: [],
    main_contributions: [],
    method_summary: "",
    result_summary: "",
    limitations: [],
    public_reception_notes: coerceStrings(json.public_reception_notes),
    source_cues: coerceStrings(json.source_cues),
    warnings: coerceStrings(json.warnings),
    page_suggestions: {
      brief: 1,
      normal: 2,
      detailed: 3
    }
  } as PaperBrief;
};

export const analyzePaperPdf = async (params: AnalyzePaperPdfParams): Promise<PaperBrief> => {
  const filePayload = await fileToBase64(params.file);
  const response = await generateGeminiContent<{ text: string }>({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: filePayload.mimeType, data: filePayload.base64, name: filePayload.name } },
          {
            text: `업로드된 논문 PDF를 읽고, 소설처럼 쉽게 읽히는 논문 해설 원고 JSON을 만들어줘.

독자 수준: ${params.audience_level}
상세도: ${params.detail_level}
출력 포맷: ${params.publication_format}

규칙:
- PDF에서 확인되는 내용만 사용하세요.
- 불확실한 내용은 warnings/source_cues에 표시하세요.
- 논문 제목/저자/DOI 등으로 확인 가능한 공개 반응이 있으면 public_reception_notes에 넣으세요.
- JSON 필드는 paper_title, explainer_story, public_reception_notes, source_cues, warnings만 채우세요.
${paperReceptionGuidance}
${paperStoryGuidance}`
          }
        ]
      },
      config: {
        systemInstruction: "당신은 논문을 문외한용 해설 서사로 바꾸는 연구 스토리 에디터입니다. 출력은 JSON만 반환하세요.",
        responseJsonSchema: paperBriefResponseJsonSchema,
        tools: [{ googleSearch: {} }]
      }
  });
  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  return normalizePaperBrief(json);
};

export const analyzePaperUrl = async (params: AnalyzePaperUrlParams): Promise<PaperBrief> => {
  const url = params.url.trim();
  const response = await generateGeminiContent<{ text: string }>({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [
          {
            text: `아래 논문 URL을 조사해서 소설처럼 쉽게 읽히는 논문 해설 원고 JSON을 만들어줘.

논문 URL: ${url}
독자 수준: ${params.audience_level}
상세도: ${params.detail_level}
출력 포맷: ${params.publication_format}

규칙:
- 반드시 이 URL과 검색으로 확인 가능한 논문 정보만 사용하세요.
- URL이 논문 페이지인지, PDF 원문 링크가 있는지, HTML 본문/초록/메타데이터만 접근 가능한지 확인하세요.
- PDF 원문 또는 본문 전체가 확인되지 않으면 방법/결과/한계를 과감히 단정하지 말고 warnings와 source_cues에 접근 한계를 적으세요.
- DOI/저널 랜딩/초록 페이지만 확인되는 경우에도 확인 가능한 범위에서 보수적인 해설 원고를 만드세요.
- source_cues에는 사용한 URL, PDF 링크, 초록/본문/메타데이터 접근 상태를 짧게 남기세요.
- 공개 리뷰, 학회/전문가 코멘트, 뉴스레터/블로그, X/Reddit 같은 커뮤니티 반응이 확인되면 public_reception_notes에 넣으세요.
- JSON 필드는 paper_title, explainer_story, public_reception_notes, source_cues, warnings만 채우세요.
${paperReceptionGuidance}
${paperStoryGuidance}`
          }
        ]
      },
      config: {
        systemInstruction: "당신은 논문 URL을 조사해 문외한용 해설 서사로 바꾸는 연구 스토리 에디터입니다. 출력은 JSON만 반환하세요.",
        responseJsonSchema: paperBriefResponseJsonSchema,
        tools: [{ googleSearch: {} }]
      }
  });
  const json = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || response.text);
  return normalizePaperBrief(json);
};
