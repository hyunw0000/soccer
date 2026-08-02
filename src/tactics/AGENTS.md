# Tactics 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **3 — 경기 전 전술·MatchSetup 조립**
- 담당 기능: 기본 전술, 전술 입력·검증, lineup·opponent·선수 메타를 결합한 MatchSetup 생성.
- 담당하지 않는 기능: 선수 원본 데이터, 대진 생성, 시뮬레이션 물리, 경기 렌더링, 앱 저장 구현.

## 2. 수정 허용 범위

- 기본 허용: `src/tactics/**` 및 그 아래 새 파일.
- 함께 소유: `src/lineup/**`. tactics 작업 중에는 필요 없이 함께 수정하지 않는다.
- 페이지 CSS: `src/tactics/screens/tactics.css`와 tactics 화면 아래 새 전용 CSS만 허용한다.
- 공용 UI가 필요하면 담당자 1에게 요청한다.

## 3. 공개 API와 계약

- 외부는 `src/tactics/index.js`만 사용한다.
- 전술: `TACTIC_DEFAULT`(freeze), `createDefaultTactics`, `TACTIC_KEYS`, `TACTIC_META`, `normalizeTactics`, `validateTactics`.
- MatchSetup: `MATCH_SETUP_VERSION`, `createMatchSetup`(유효하지 않으면 `MatchSetupError` throw), `validateMatchSetupInput`, `validateMatchSetup`, `toSimulationPlayer`, `MatchSetupError`.
- 화면: `tacticsScreen`.
- `createMatchSetup`은 `opponent`가 없으면 실패한다. 대진표(담당자 2)가 붙기 전까지 화면은 MatchSetup을 만들지 않고 기존 경기 진입 경로를 쓴다.
- 위 목록을 바꾸려면 공개 계약을 먼저 협의한다.
- 입력은 `src/roster/index.js`, `src/lineup/index.js`, 향후 `src/tournament/index.js`의 공개 값만 사용한다.
- MatchSetup version 1에는 양 팀 SimulationPlayer, assignment의 `playerId`·`slotId`·`role`·`x`·`z`, tactics와 tournament 참조를 포함한다.
- assignment의 `instruction`(자리별 전술 8축, 0..1)은 계약상 **선택 항목**이지만, `createMatchSetup`은 양 팀 모든 자리에 항상 싣는다. 감독이 만진 적 없는 자리는 `slotTacticsOf()`가 만드는 그 자리의 기본값이 실린다 — 안 실으면 simulation이 0.5로 읽어서 화면에 보이는 값과 경기가 어긋난다. 계약 자체는 version 1 그대로다. 축 이름은 `INSTRUCTION_KEYS`가 단일 출처이며, 감독이 만지는 1..5 단계 값은 `toPlayerInstruction()`으로만 0..1로 번역한다.
- 개인 전술은 **자리(slotId)** 에 붙는다. 저장은 `state.slotTactics`이고 조회는 `slotTacticsOf(book, assignment)` 하나뿐이다. 선수를 바꿔 세워도 그 자리의 지시로 뛰고, 선수는 지시를 들고 다니지 않는다.
- 개인 전술 화면은 8축을 다 보여 주지 않는다. `playerTacticGroup(role, z)`가 그 자리(골키퍼·센터백·풀백·중앙 미드·측면·중앙 공격수)에서 쓸 항목과 이름을 정하고, 화면에 없는 축은 그 자리의 기본값에 머문다. 계약은 늘 8축 그대로다.
- 화면 이동은 `ctx.navigate()`를 사용하고 route params에 영속 상태를 저장하지 않는다.

## 4. 절대 금지

- 허용 경로 밖 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리 설치, 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- 범위 밖 버그 직접 수정, 팀 결정 필요 정책 구현, 범위 밖 UI·게임 규칙·선수 데이터 변경을 금지한다.
- simulation 내부를 import하거나 빌드 오류를 이유로 다른 폴더를 수정하지 않는다.
- 금지 경로가 바뀌면 완료로 보고하지 않는다.

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

- 전술 값 0..1, 상대 결정, 양 팀 선수 메타와 유효한 라인업을 검사한 뒤에만 MatchSetup을 만든다.
- 현재 결합 화면을 기능 변경 없이 유지하며 화면 분리는 별도 합의 작업으로 한다.
- 완료 조건: 유효한 MatchSetup version 1만 생성, simulation import 없음, public index 경계, 페이지 CSS 토큰 준수, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`; 종료 시 `git diff --check`, `npm run build`.
- 전술 범위, 포메이션 변경, assignment 필드와 MatchSetup 직렬화 가능 여부를 확인한다.
- 마지막에 변경 파일, 검증 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
