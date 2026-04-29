import { AudienceLevel, ComicMode, DeliveryStyleId, DeliveryStylePreset, DeliveryStyleSpec } from "../types";

export const DELIVERY_STYLE_PRESETS: DeliveryStylePreset[] = [
  {
    id: "standard",
    label: "일반적(표준)",
    instruction:
      "진짜 사람이 아주 자연스러운 말투로 설명하듯 쓰세요. 말풍선은 정보 요약문이 아니라 캐릭터가 장면 안에서 상대에게 직접 말하는 자연스러운 발화처럼 작성하세요. 필요한 개념도 체크리스트/슬라이드 문장이 아니라 상황 속 설명과 반응으로 풀어주세요. 한 가지 종결어미에 고정하지 말고 질문, 관찰, 반응, 정리의 말끝을 자연스럽게 섞으세요. 제스처는 과장하지 말고 자연스럽게(가리키기/끄덕임/손바닥 펼치기) 사용하세요.",
    recommended_audience: ["kids", "teen", "beginner", "intermediate", "expert"]
  },
  {
    id: "community",
    label: "인터넷 커뮤니티 말투",
    instruction:
      "인터넷 커뮤니티의 가벼운 리듬(짧은 문장, 리액션, 밈 느낌)을 살리되, 욕설/비하/혐오 표현은 절대 금지입니다. 독자가 이해하기 쉽도록 핵심은 또렷하게 말하세요. 제스처는 과장된 리액션(당황, 손바닥으로 '짠', 과장된 표정)을 가볍게 곁들이세요.",
    recommended_audience: ["teen", "beginner", "intermediate"]
  },
  {
    id: "friendly_banmal",
    label: "친근한 반말",
    instruction:
      "다정한 친구처럼 친근한 반말로 말하되, 무례하거나 비하하는 느낌은 금지입니다. 문장은 짧게 끊고, 중요한 용어도 딱딱한 정의문보다 친구가 쉽게 풀어주는 말투로 설명하세요. 제스처는 친근하게(어깨 으쓱, 손 흔들기, 하이파이브) 사용하세요.",
    recommended_audience: ["kids", "teen", "beginner"]
  },
  {
    id: "elder",
    label: "어르신 대상",
    instruction:
      "어르신도 편하게 이해할 수 있게 쉬운 단어를 우선하고, 속도를 천천히(핵심→예시→한 줄 요약) 가져가세요. 존댓말을 사용하고, 너무 최신 유행어/영어 남발은 피하세요. 제스처는 차분하게(손으로 도표 그리기, 고개 끄덕임) 사용하세요.",
    recommended_audience: ["beginner", "intermediate"]
  },
  {
    id: "half_honorific",
    label: "반존대",
    instruction:
      "반말과 존댓말을 섞는 '반존대' 톤으로 진행하세요. 예: \"그거 알지? 근데 중요한 건 이거예요.\" 같은 리듬. 다만 상대를 깎아내리거나 꼽주는 느낌은 금지입니다. 제스처는 장난스럽게(손가락으로 콕, 윙크는 과하지 않게) 사용하세요.",
    recommended_audience: ["teen", "beginner"]
  },
  {
    id: "military",
    label: "군인 말투",
    instruction:
      "군대식 보고/지시 말투를 코믹하게 사용하되, 폭력/가혹행위/혐오를 미화하지 마세요. 예: \"정리하겠습니다\", \"핵심은 두 가지입니다\" 같은 구조화된 표현. 제스처는 경례/자세 바로/수첩 기록 같은 동작을 가볍게 사용하세요.",
    recommended_audience: ["teen", "beginner", "intermediate"]
  },
  {
    id: "kindergarten_teacher",
    label: "유치원 선생님",
    instruction:
      "유치원 선생님처럼 아주 상냥하고 쉬운 말로, 짧은 문장과 반복(핵심 단어 1~2회)으로 설명하세요. 무서운 표현/불안 조장은 금지입니다. 제스처는 박수, 손 하트, 손가락으로 '하나-둘-셋' 세기 등으로 크게 보여 주세요.",
    recommended_audience: ["kids"]
  },
  {
    id: "custom",
    label: "직접 입력(커스텀)",
    instruction:
      "사용자 지정 말투/제스처 지침을 그대로 따르되, 욕설/혐오/비하/노골적 성적 표현은 금지입니다.",
    recommended_audience: ["kids", "teen", "beginner", "intermediate", "expert"]
  }
];

const findPreset = (id: DeliveryStyleId | string | undefined): DeliveryStylePreset =>
  DELIVERY_STYLE_PRESETS.find((p) => p.id === id) || DELIVERY_STYLE_PRESETS[0];

const CINEMATIC_PRESET_INSTRUCTIONS: Record<DeliveryStyleId, string> = {
  standard:
    "자연스러운 구어체로 짧고 밀도 있게 말하세요. 설명/정의/강의문 톤은 금지하고, 감정선과 관계 변화가 드러나는 대사만 사용하세요. 제스처는 과장보다 리듬(멈춤, 시선 이동, 짧은 손동작) 중심으로.",
  community:
    "커뮤니티 리듬(짧은 반응, 날렵한 템포)을 살리되 장면 몰입을 깨는 밈 남발은 금지하세요. 욕설/비하/혐오 표현 금지. 대사는 감정 반응과 갈등 전개에만 쓰세요.",
  friendly_banmal:
    "친근한 반말을 쓰되 가벼운 수다체가 아니라 감정 충돌이 살아있는 대사로 유지하세요. 설명형 문장 금지. 제스처는 친근하지만 상황의 긴장을 유지하세요.",
  elder:
    "차분하고 명료한 존댓말을 유지하되 강의식 설명은 금지하세요. 대사는 짧고 인물의 선택/감정 변화가 보이게 작성하세요.",
  half_honorific:
    "반존대 리듬으로 자연스럽게 전개하되 조롱/비하 톤은 금지하세요. 설명형 문장 대신 관계 변화와 긴장을 드러내는 짧은 대사를 사용하세요.",
  military:
    "군대식 리듬은 어투 스타일로만 사용하고 폭력/가혹/혐오 미화는 금지하세요. 지시형 문장보다 갈등 국면의 결단/긴장을 드러내는 대사를 우선하세요.",
  kindergarten_teacher:
    "부드럽고 쉬운 어투를 유지하되 수업식 설명은 금지하세요. 안전하고 따뜻한 감정선 속에서 사건 반응 중심의 짧은 대사를 사용하세요.",
  custom:
    "사용자 지정 톤을 따르되 설명/강의문 톤은 금지하고, 감정선/갈등/전환 중심의 시네마틱 대사로 유지하세요."
};

const getCinematicPresetInstruction = (preset: DeliveryStylePreset, customInstruction: string): string => {
  const base = CINEMATIC_PRESET_INSTRUCTIONS[preset.id] || CINEMATIC_PRESET_INSTRUCTIONS.standard;
  if (preset.id !== "custom") return base;
  return customInstruction
    ? `${base}\n\n[사용자 지정 추가 지침]\n${customInstruction}`
    : base;
};

export const resolveDeliveryStyleSpec = (params: {
  preset_id: DeliveryStyleId;
  custom_instruction?: string;
  audience_level: AudienceLevel;
  comic_mode?: ComicMode;
}): DeliveryStyleSpec => {
  const preset = findPreset(params.preset_id);
  const comicMode: ComicMode = params.comic_mode || "learning";
  const isPureCinematic = comicMode === "pure_cinematic";

  const isUnsafe =
    Array.isArray(preset.unsafe_for_audience) && preset.unsafe_for_audience.includes(params.audience_level);

  const userCustom = String(params.custom_instruction || "").trim();
  const customTail =
    preset.id === "custom" && userCustom
      ? `\n\n[사용자 지정 추가 지침]\n${userCustom}`
      : "";

  if (isUnsafe) {
    if (isPureCinematic) {
      return {
        preset_id: "standard",
        preset_label: "시네마틱(표준) — (선택한 말투가 해당 독자층에 부적합하여 자동 순화됨)",
        instruction: CINEMATIC_PRESET_INSTRUCTIONS.standard
      };
    }
    return {
      preset_id: "standard",
      preset_label: "일반적(표준) — (선택한 말투가 해당 독자층에 부적합하여 자동 순화됨)",
      instruction: DELIVERY_STYLE_PRESETS[0].instruction
    };
  }

  if (isPureCinematic) {
    return {
      preset_id: preset.id,
      preset_label: preset.label,
      instruction: getCinematicPresetInstruction(preset, userCustom)
    };
  }

  return {
    preset_id: preset.id,
    preset_label: preset.label,
    instruction: `${preset.instruction}${customTail}`.trim()
  };
};
