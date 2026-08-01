# Simulation 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **4 — 시뮬레이션·되감기**
- 담당 기능: 결정론적 경기 상태, 선수·공 이동, 경기 규칙, 정규화→월드 좌표, snapshot/restore/rewind.
- 담당하지 않는 기능: 선수·라인업·전술 조회, DOM/HUD, Three.js, route, 대진표 반영.

## 2. 수정 허용 범위

- 기본 허용: `src/simulation/**` 및 그 아래 새 파일.
- 함께 소유: `src/match/**`. simulation 작업 중에는 필요 없이 함께 수정하지 않는다.
- 페이지 CSS 없음. simulation에는 CSS·DOM 파일을 만들지 않는다.

## 3. 공개 API와 계약

- 외부는 `src/simulation/index.js`만 사용한다.
- 현재 export: `FIELD`, `HALF`, `GOAL_W`, `PARAMS`, `slotPosition`, `Sim`, `RewindBuffer`.
- 현재 엔진은 호환 생성자와 정규화 슬롯 배열을 사용한다. 목표 `createSimulation(matchSetup)`, `createRewindBuffer`, `normalizedToWorld` 전환은 MatchSetup version 1 합의 후 단계적으로 수행한다.
- 최종 입력은 완성된 plain JSON MatchSetup뿐이다. roster, lineup, tactics의 내부나 `index.js`도 import하지 않는다.
- assignment의 `instruction`(선수별 지시 8축, 0..1)은 선택 항목이다. 없으면 `INSTRUCTION_FALLBACK`(전부 0.5)로 읽으므로 MatchSetup version 1 그대로 동작한다. simulation은 감독이 만지는 1..5 단계 값을 모른다 — 계약에 실려 온 0..1만 쓴다.
- 지시는 경기 중 변하지 않는 입력이므로 `snapshot()`에 담지 않는다. 담으면 되감기 크기만 커지고 재현성에는 보탬이 없다.
- renderer가 결과를 결정하지 않도록 simulation이 MatchState와 MatchResult의 원천이 된다.

## 4. 절대 금지

- 허용 경로 밖 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다. simulation은 roster·lineup·tactics 공개 index도 import하지 않는다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- DOM, 브라우저 UI, Three.js import, 외부 라이브러리 설치를 금지한다.
- 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- 범위 밖 버그 직접 수정, 팀 결정 필요 정책 구현, 범위 밖 UI·선수 데이터 변경을 금지한다.
- 빌드 오류를 이유로 다른 담당 폴더를 수정하지 않는다. 금지 경로가 바뀌면 완료로 보고하지 않는다.

## 5. 담당 범위 밖 변경 요청

```text
[담당 영역 변경 요청]

요청 대상 담당자:
대상 경로:
발견한 문제:
재현 방법:
현재 동작:
기대 동작:
필요한 공개 API 또는 데이터 필드:
내 담당 영역에서 임시 대응했는지:
```

직접 수정하지 않고 마지막 보고의 **담당자 간 요청 사항**에 남긴다.

## 6. 주요 작업과 완료 조건

- MVP 우선: 기존 엔진 유지, MatchSetup 입력 전환, 좌표 변환, 기본 진행·제한된 되감기·결과 생성.
- 고급 AI·패스/슛 판단·통계·효과·최적화는 MVP 완료 전에 시작하지 않는다.
- 완료 조건: 같은 seed 결정론, snapshot/restore 동등성, 유효하지 않은 입력 거부, DOM/Three import 0개, feature import 0개, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`; 종료 시 `git diff --check`, `npm run build`.
- 동일 seed, step, 골·종료, rewind 범위와 snapshot 복원을 확인한다.
- 마지막에 변경 파일, 검증 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
