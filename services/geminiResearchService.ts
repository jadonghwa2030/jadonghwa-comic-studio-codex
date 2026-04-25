import type { ComicMode, GroundingSource, NarrativeRole, QuestionType, ResearchPack, IntroStyle, ScriptDetail } from "../types";
import { postJson } from "./localApi";

const getGeminiResearchModel = (): string => {
  const codexPreferred = (import.meta as any).env?.VITE_CODEX_RESEARCH_MODEL as unknown;
  if (typeof codexPreferred === "string" && codexPreferred.trim()) return codexPreferred.trim();
  const codexPlanner = (import.meta as any).env?.VITE_CODEX_PLANNER_MODEL as unknown;
  if (typeof codexPlanner === "string" && codexPlanner.trim()) return codexPlanner.trim();
  const preferred = (import.meta as any).env?.VITE_GEMINI_RESEARCH_MODEL as unknown;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  const planner = (import.meta as any).env?.VITE_GEMINI_PLANNER_MODEL as unknown;
  if (typeof planner === "string" && planner.trim()) return planner.trim();
  return "gpt-5.5";
};

const getGeminiResearchMaxOutputTokens = (): number => {
  const preferred =
    ((import.meta as any).env?.VITE_CODEX_RESEARCH_MAX_OUTPUT_TOKENS as unknown) ||
    ((import.meta as any).env?.VITE_GEMINI_RESEARCH_MAX_OUTPUT_TOKENS as unknown);
  if (typeof preferred === "string" && preferred.trim()) {
    const parsed = Number(preferred);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 8000;
};

const safeParseJson = (text: string): any => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Codex returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Codex returned invalid JSON.");
    return JSON.parse(match[0]);
  }
};

const coerceSources = (value: unknown): GroundingSource[] => {
  if (!Array.isArray(value)) return [];
  const dedup = new Map<string, GroundingSource>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const anyItem = item as any;
    const uri = String(anyItem.uri ?? anyItem.url ?? anyItem.link ?? "").trim();
    if (!uri) continue;
    const title = String(anyItem.title ?? anyItem.name ?? "참고 자료").trim() || "참고 자료";
    if (!dedup.has(uri)) dedup.set(uri, { title, uri });
  }

  return Array.from(dedup.values());
};

const coercePageSuggestions = (value: unknown): Record<ScriptDetail, number> => {
  const raw = value && typeof value === "object" ? value as any : {};
  return {
    brief: Math.max(1, Math.floor(Number(raw.brief || 1))),
    normal: Math.max(1, Math.floor(Number(raw.normal || 2))),
    detailed: Math.max(1, Math.floor(Number(raw.detailed || 3)))
  };
};

const extractGeminiSources = (json: any): GroundingSource[] => {
  const chunks = json?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  return coerceSources(chunks.map((chunk: any) => chunk?.web).filter(Boolean));
};

const geminiGenerateContent = async (request: any): Promise<any> => {
  return await postJson<any>("/api/codex/generate-content", { request });
};

export const generateGeminiResearchPack = async (params: {
  topic: string;
  question_type: QuestionType;
  comic_mode?: ComicMode;
  character_role: NarrativeRole;
  intro_style?: IntroStyle;
  reasoning_effort?: "low" | "medium" | "high";
}): Promise<ResearchPack> => {
  const looksLikeHowToTopic = (topic: string): boolean => {
    const t = String(topic || "").trim();
    if (!t) return false;
    return /(방법|하는\s*법|만드는\s*법|만들기|레시피|조리법|요리|튜토리얼|가이드|절차|순서|단계|설치|세팅|설정|사용법|how\s*to|tutorial|guide|recipe|setup|install)/i.test(t);
  };

  const looksLikeActionTopic = (topic: string): boolean => {
    const t = String(topic || "").trim();
    if (!t) return false;
    return /(격투|싸움|대결|전투|배틀|결투|무술|복싱|킥복싱|레슬링|ufc|mma|액션|추격|도주|추적|잠입|전쟁|combat|fight|fighting|battle|duel|martial|chase)/i.test(t);
  };

  const introStyle: IntroStyle = params.intro_style || "standard";
  const comicMode: ComicMode = params.comic_mode || "learning";
  const isEduCinematic = comicMode === "cinematic";
  const isPureCinematic = comicMode === "pure_cinematic";
  const isActionTopic = looksLikeActionTopic(params.topic);

  const model = getGeminiResearchModel();
  const reasoningEffort = params.reasoning_effort || "medium";
  const maxOutputTokens = getGeminiResearchMaxOutputTokens();

  const roleLine =
    params.character_role === "narrator"
      ? isPureCinematic
        ? "주인공은 제3자 관찰자/반응자입니다. 설명자가 아니라, 사건을 목격하고 선택을 유도하는 역할로 재료를 정리하세요."
        : isEduCinematic
          ? "주인공은 제3자 가이드/관찰자입니다. 과도한 해설 대신 장면에서 의미가 보이게 정리하세요."
          : "주인공은 제3자 가이드/관찰자(설명자)입니다. 실제 대상(인물/사물/원리)은 주인공과 분리될 수 있게 정리하세요."
      : isPureCinematic
        ? "주인공은 사건의 중심 배우입니다. 욕망-갈등-선택-대가가 보이는 행동/상황 중심으로 정리하세요."
        : "주인공이 주제의 핵심 인물/원리/대상이 되어 직접 연기합니다. 장면화 가능한 행동/상황 중심으로 정리하세요.";

  const questionLine = (() => {
    if (params.question_type === "review") {
      return isPureCinematic
        ? "질문 형태: Cinematic Review. 평가표보다 체험/문제/전환/여운으로 구성."
        : "질문 형태: Review (제품/물건). 평가 기준(3~7개)을 먼저 선언하고, 장점/단점/주의/추천 대상을 조건부로 정리.";
    }
    if (params.question_type === "compare") {
      return isPureCinematic
        ? "질문 형태: Cinematic Compare (라이벌전). 승자 단정 논설문 금지, 충돌-반전-결판 중심."
        : '질문 형태: Compare (A vs B). 승자 단정 금지. 비교축 기반의 조건부 결론.';
    }
    if (isPureCinematic) {
      return "질문 형태: Cinematic Explain. 강의형 설명 대신 로그라인/갈등/장면 전개 중심으로 구성.";
    }
    if (introStyle === "myth_busting") {
      return "질문 형태: Explain (Myth-busting). 오해/선입견 1~3개를 먼저 제시하고, myth→fact로 부드럽게 교정하며 설명을 전개. (조롱 금지, 안전한 톤)";
    }
    if (looksLikeHowToTopic(params.topic)) {
      return "질문 형태: Explain (How-to). '방법/절차/레시피/튜토리얼' 주제이므로, 오해 반박형 훅(“~라고 생각했겠지만…”)을 강제하지 말고 바로 따라할 수 있게 구성.";
    }
    return '질문 형태: Explain (Concept / Standard). 첫 문장은 "A란/현재진행형이란/오늘은 A를 배워요"처럼 정의/목표로 바로 시작하세요. 도입에서 "단순히 ~가 아니라", "단순한 ~가 아니라", "그것은 단순한 ~가 아니라, ~다", "많이들 ~라고 생각하지만", "사실은", "오해/착각" 같은 AI식 반박/대조 프레이밍을 쓰지 마세요. 오해 교정은 필요할 때만 중후반에 짧게.';
  })();

  const notesHeaderHint = isPureCinematic
    ? params.question_type === "compare"
      ? "[LOGLINE], [RIVALS], [CONFLICT AXES], [TURNING POINT], [ENDING HOOK], [VISUAL MOTIFS], [UNKNOWN], [SAFETY REDLINES], [SCENE IDEAS]"
      : params.question_type === "review"
        ? "[SETUP], [PAIN POINT], [TEST/CHASE], [TURNING POINT], [VERDICT MOMENT], [VISUAL MOTIFS], [UNKNOWN], [SAFETY REDLINES], [SCENE IDEAS]"
        : "[LOGLINE], [WORLD], [CHARACTER DESIRE], [CONFLICT], [TURNING POINT], [ENDING HOOK], [VISUAL MOTIFS], [UNKNOWN], [SAFETY REDLINES], [SCENE IDEAS]"
    : params.question_type === "review"
      ? "[PRODUCT], [CRITERIA], [PROS], [CONS], [VERDICT], [UNKNOWN], [DO NOT SAY], [SCENE IDEAS]"
      : "[FRAMING], [ONE LINE], [KEY POINTS], [DEFINITIONS], [MISCONCEPTIONS], [UNKNOWN], [DO NOT SAY], [SCENE IDEAS]";

  const modeLabel = isPureCinematic ? "CINEMATIC" : isEduCinematic ? "EDU-CINEMATIC" : "LEARNING";

  const systemInstruction = isPureCinematic
    ? `당신은 시네마틱 스토리 제작을 위한 리서치 에디터입니다.

목표:
- Google Search를 사용해 최신/기본 정보를 확인한 뒤, 시네마틱 플래너가 바로 사용할 수 있는 "Research Pack"을 만듭니다.

규칙(매우 중요):
- 확인 불가/근거 부족은 반드시 "UNKNOWN"으로 표시하고, 추측으로 채우지 마세요.
- 숫자/연도/고유명사/인과관계는 특히 엄격하게 검증하세요.
- notes는 강의 요약문이 아니라, 장면/갈등/전환을 만들 수 있는 창작 재료 중심으로 작성하세요.
- 액션/격투가 주제인 경우, 액션 자체를 삭제하지 말고 비고어(PG-13) 범위의 공방/추격 단서를 notes에 포함하세요.
- 특정 개인/집단 비방·허위사실·명예훼손성 내용은 금지하세요.
- 출력은 반드시 한국어.
- 출력은 JSON만.`
    : `당신은 ${isEduCinematic ? "Edu-Cinematic" : "교육 만화"} 제작을 위한 리서치 에디터입니다.

목표:
- Google Search를 사용해 최신/기본 정보를 확인한 뒤, 플래너가 바로 사용할 수 있는 "Research Pack"을 만듭니다.

규칙(매우 중요):
- 확인 불가/근거 부족은 반드시 "UNKNOWN"으로 표시하고, 추측으로 채우지 마세요.
- 숫자/연도/고유명사/인과관계는 특히 엄격하게 검증하세요.
- 상투적 AI 말투 금지: "그것은 단순한 A가 아니라 B다", "단순히 A가 아니라 B" 같은 not just A but B 직역/대조 문장 구조를 쓰지 마세요. 같은 의미는 "B까지 포함한다/확장한다/핵심은 B다"처럼 긍정문으로 바로 쓰세요.
- 출력은 반드시 한국어.
- 출력은 JSON만.`;

  const userPrompt = `모드: ${modeLabel}
주제: "${params.topic || "UNKNOWN"}"
${questionLine}
${roleLine}

다음을 만족하는 Research Pack을 작성하세요.
- notes: 플래너가 그대로 붙여넣어 쓸 수 있는 짧고 구조화된 텍스트
  - 섹션 헤더는 ${notesHeaderHint} 권장
  - ${isPureCinematic ? "교훈/강의체 요약보다 장면화 가능한 행동/관계/소품 단서를 우선하세요." : '[MISCONCEPTIONS]: intro_style가 "오해 깨기"인 경우 1~3개를 우선 포함. 그 외에는 선택 사항(필요 없으면 생략하거나 "없음" 표기).'}
  - ${isPureCinematic && isActionTopic ? "주제가 액션/격투 계열이면 물리적 충돌 비트(공방/회피/반격)를 최소 2개 이상 포함하세요. (고어/절단/과도한 유혈은 금지)" : "SAFETY REDLINES는 혐오/명예훼손/노골적 성묘사/고어 중심으로 작성하고, 일반 액션 자체를 일괄 금지하지 마세요."}
- sources: 참고 링크 3~8개 (title, uri)
- page_suggestions: 이 Research Pack을 만화로 만들 때 적절한 페이지 수
  - brief: 가장 짧게 핵심만 보여줄 때
  - normal: 기본 추천
  - detailed: 장면/예시/주의점을 충분히 넣을 때
  - 각 값은 1 이상 정수
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      notes: { type: "string" },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            uri: { type: "string" }
          },
          required: ["title", "uri"]
        }
      },
      page_suggestions: {
        type: "object",
        additionalProperties: false,
        properties: {
          brief: { type: "integer" },
          normal: { type: "integer" },
          detailed: { type: "integer" }
        },
        required: ["brief", "normal", "detailed"]
      }
    },
    required: ["notes", "sources", "page_suggestions"]
  };

  const baseConfig = {
    systemInstruction,
    responseMimeType: "application/json",
    responseJsonSchema: schema,
    maxOutputTokens,
    reasoningEffort
  };

  const withSearch = (config: any) => ({
    ...config,
    tools: [{ googleSearch: {} }]
  });

  const attempts = [
    withSearch(baseConfig),
    baseConfig
  ];

  let lastError: any = null;
  let json: any = null;

  for (const config of attempts) {
    try {
      json = await geminiGenerateContent({
        model,
        contents: { parts: [{ text: userPrompt }] },
        config
      });
      break;
    } catch (e: any) {
      lastError = e;
      const message = String(e?.message || "");
      if (/authentication|permission|quota|rate-?limit|oauth|login/i.test(message)) throw e;
    }
  }

  if (!json) throw lastError || new Error("Codex request failed.");

  const outputText = String(json?.text || "").trim();
  const data = safeParseJson(outputText);

  const notes = String(data?.notes ?? "").trim();
  const sources = coerceSources(data?.sources);
  const pageSuggestions = coercePageSuggestions(data?.page_suggestions);
  const fallbackSources = extractGeminiSources(json);

  if (!notes) throw new Error("Codex returned empty notes.");

  return {
    notes,
    sources: sources.length > 0 ? sources : fallbackSources,
    page_suggestions: pageSuggestions
  };
};
