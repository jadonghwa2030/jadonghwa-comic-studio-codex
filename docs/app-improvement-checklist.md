# 앱 개선 체크리스트 (Mini Brief 활용)

이 체크리스트는 “사용자 리서치(JSON) → Mini Brief 정규화 → Planner가 안정적으로 사용”의 품질을 보장하기 위한 항목입니다.

---

## A. 설계 체크

- [ ] 질문 형태 분류가 최소 2개로 정의됨: `Explain(A)`, `Compare(A vs B)`
- [ ] Mini Brief에 반드시 들어갈 필수 필드가 정해짐:
  - [ ] `safe_framing` (과장/선동 프레이밍 교정)
  - [ ] `verified_claims` (evidence 필수, URL 옵션)
  - [ ] `definitions` (경계/책임/용어)
  - [ ] `unknowns` (모르면 UNKNOWN)
  - [ ] `do_not_say` (금지 단정)
- [ ] Compare 전용 필드가 정해짐:
  - [ ] `comparison_axes`
  - [ ] `fairness_rules`
  - [ ] `where_a_wins / where_b_wins` (조건부)

---

## B. 입력/파서 체크 (가장 중요)

- [ ] JSON 파싱 실패 시에도 “텍스트 모드”로 진행 가능(현행 유지)
- [ ] 기존 포맷(`notes/key_facts/timeline/glossary/...`) 입력을 Mini Brief 텍스트로 합성
- [ ] 새 포맷(`mini_brief`) 입력을 우선 처리
- [ ] URL 정규화:
  - [ ] `[text](url)` → `url` 추출
  - [ ] `<url>` → `url` 추출
  - [ ] 공백/개행 제거 및 트림
- [ ] `sources`/`references`/`citations` 등 다양한 키를 수용
  - [ ] (선택) 링크가 있으면 References에 표시

---

## C. Planner 활용 체크

- [ ] user research 모드에서 Mini Brief 텍스트가 실제 프롬프트에 포함됨
- [ ] user research 모드에서 외부 검색 도구(googleSearch)가 비활성화됨(현행 유지)
- [ ] 질문 형태별 “안전 규칙”이 시스템 인스트럭션/프롬프트에 반영됨
- [ ] Mini Brief 불충분 시 안전 폴백:
  - [ ] 일반 원리/정의 수준으로만 구성
  - [ ] 확인 불가 사실은 “추가 리서치 필요/UNKNOWN”으로 처리

---

## D. UI/UX 체크

- [ ] 질문 형태 선택 UI가 있음(Explain/Compare)
- [ ] 리서치 프롬프트(Copy)가 질문 형태를 반영
- [ ] 붙여넣은 입력이 “Mini Brief 미리보기(정규화 결과)”로 확인 가능(권장)
- [ ] References에 링크가 정상 클릭됨(마크다운 링크 입력도 포함)

---

## E. QA 시나리오(수동)

- [ ] Explain 샘플 1: 과학 개념(정의/오해/비유 포함)
- [ ] Explain 샘플 2: 민감/정확성 요구 주제(UNKNOWN 처리 확인)
- [ ] Compare 샘플 1: 기술/규제/책임 축 비교
- [ ] Compare 샘플 2: 비교 불가/축 불충분(“비교 불가” 결론 허용 확인)
- [ ] `sources.uri`에 `[https://...](https://...)` 형태를 넣어도 References가 정상 링크로 열림

---

## F. Cinematic Mode 체크

- [ ] Comic Mode가 최소 2개로 정의됨: `learning`, `cinematic`
- [ ] 03. The Mission에서 Comic Mode 선택 UI가 있음
- [ ] Cinematic 선택 시 Planner 프롬프트가 “설명 금지 / 장면 전개” 규칙으로 분기됨
- [ ] Cinematic에서 `scene/acting/camera/mood` 필드가 적극적으로 채워짐(특히 acting은 구체 지시)
- [ ] 실존 인물 등장 시:
  - [ ] 사실 주장처럼 단정하지 않고 가상 시나리오로 처리
  - [ ] 과도한 비방/모욕/명예훼손성 설정을 피함
- [ ] 폭력 장면이 있어도 고어/잔혹 묘사 없이 PG-13 수준으로 유지됨
