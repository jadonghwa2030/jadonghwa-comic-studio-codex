# 앱 개선 로드맵 (Research → Mini Brief → Plan)

목표: 사용자가 붙여넣는 “자료 조사 결과”를 단순 요약(`notes`)이 아니라 **검증된/정제된 ‘미니 기획서(Mini Brief)’** 형태로 입력받고, 앱이 이를 **구조적으로** 활용해 더 안정적인 만화용 스크립트(플랜)를 생성하도록 개선합니다.

---

## 0) 현 상태 진단 (문제 정의)

- **실제 프롬프트에 쓰이는 건 거의 `notes`뿐**: `key_facts/timeline/glossary/...`는 대부분 스크립트 생성에 직접 반영되지 않음.
- **`sources`는 주로 “References UI 표시”용**: 스크립트 생성 프롬프트로 들어가지 않음.
- **URL 포맷 취약**: 사용자가 `[text](url)` 같은 마크다운 링크로 붙여넣으면, `href`로 그대로 쓰여 References 링크가 깨질 수 있음.
- **질문 형태(Explain vs Compare) 구분이 없음**: `A vs B`는 비교축/공정성 규칙이 없으면 과장·승부 프레임으로 흐르기 쉬움.

---

## 1) 목표 사용자 경험(UX) 정의

### 사용 흐름 (권장)
1. 사용자는 **질문 형태**를 선택한다: `Explain(A)` / `Compare(A vs B)`
2. 앱이 외부 리서치 도구(또는 다른 모델)에 붙여넣을 **리서치 프롬프트**를 제공한다.
3. 사용자는 결과(JSON)를 앱에 붙여넣는다.
4. 앱은 JSON을 **Mini Brief(구조화 텍스트)**로 정규화하여 모델 입력으로 사용한다.
5. 플랜 결과에는 References가 함께 표시된다.

---

## 2) Mini Brief 데이터 모델 (ResearchPack v2)

### 핵심 원칙
- **fact / interpretation / analogy / unknown**를 구분한다.
- 근거 없는 단정 금지: “핵심 주장(verified_claims)”은 **evidence를 필수로** 포함하고, URL은 옵션으로 둔다.
- `Compare`는 “승자”가 아니라 **조건부 결론**을 기본으로 한다.

### 제안 JSON 스키마(외부 리서치 결과)
최소 형태:
```json
{
  "question": { "type": "explain", "topic": "..." },
  "mini_brief": {
    "one_line_takeaway": "...",
    "safe_framing": "선동/과장 없이 다시 쓴 질문/프레이밍",
    "verified_claims": [
      { "claim": "...", "evidence": "짧은 근거(링크 없이도 OK)" }
    ],
    "definitions": [
      { "term": "...", "definition": "..." }
    ],
    "unknowns": ["UNKNOWN ..."],
    "do_not_say": ["근거 없이 단정 금지 문장/표현"]
  }
}
```

`Compare` 확장:
```json
{
  "question": { "type": "compare", "a": "...", "b": "..." },
  "mini_brief": {
    "comparison_axes": ["정의/책임", "검증가능성", "규제", "기술 접근"],
    "where_a_wins": ["조건 ..."],
    "where_b_wins": ["조건 ..."],
    "fairness_rules": ["같은 기준으로 비교", "측정 불가 항목은 UNKNOWN 처리"]
  }
}
```

---

## 3) 앱 변경 범위

### (A) UI
- 질문 형태 선택: `Explain` / `Compare`
- (선택) Compare 시 `A`, `B` 분리 입력
- 리서치 프롬프트(`Copy`)는 질문 형태에 맞게 출력
- (권장) “Mini Brief 미리보기” 영역: 붙여넣은 JSON이 앱에서 어떤 **정규화 텍스트**로 변환되는지 확인 가능

### (B) 파서/정규화(핵심)
- 기존 JSON(현재 포맷: `notes/key_facts/timeline/...`)도 받아서 **Mini Brief 텍스트로 합성**
- URL 정규화: 마크다운 링크(`[x](url)`) / `<url>` 등에서 **실제 URL만 추출**
- `sources`는 옵션(References 표시용). 없어도 된다.

### (C) Planner 프롬프트
- user research 모드에서는 Mini Brief를 최우선 입력으로 사용
- 질문 형태별 안전 규칙 추가:
  - Explain: “정의/경계 + 오해/반례 + 조건부 결론”
  - Compare: “비교축 기반 + 공정성 규칙 + 승자 선언 금지 + 직접 비교 불가도 허용”

---

## 4) 단계별 마일스톤

- M0: 로드맵/체크리스트 문서화
- M1: ResearchPack 정규화(파서) + URL 정리 + References 안정화
- M2: 질문 형태 UI/리서치 프롬프트 템플릿 추가
- M3: Planner에 질문 형태별 지침 반영(프롬프트/시스템 인스트럭션)
- M4: QA/회귀 테스트(샘플 JSON 3~5개) + 문구 튜닝

---

## 5) 수용 기준(Definition of Done)

- 붙여넣은 JSON의 `key_facts/timeline/...`가 **Mini Brief 텍스트에 반영**된다.
- `[text](url)` 형태로 들어와도 References 링크가 깨지지 않는다.
- `Compare(A vs B)`에서 “승자 단정” 대신 **축 기반·조건부 결론**이 기본 출력된다.
- Mini Brief가 비어 있거나 불충분하면, 모델이 **UNKNOWN/추가 리서치 필요**로 안전하게 처리한다.
