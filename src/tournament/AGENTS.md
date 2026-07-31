# Tournament 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **2 — 대진표·대회 진행**
- 담당 기능: 승인된 정책에 따른 bracket 생성·검증, 현재 라운드·다음 상대 계산, MatchResult 반영.
- 담당하지 않는 기능: 경기 결과 생성, 선수 데이터, 라인업·전술, AppState 저장 구현, 미승인 제품 정책 결정.

## 2. 수정 허용 범위

- 기본 허용: `src/tournament/**` 및 그 아래 새 파일.
- 함께 소유: `src/roster/**`. tournament 작업 중에는 필요 없이 함께 수정하지 않는다.
- 페이지 CSS: `src/tournament/screens/tournament.css`와 tournament 화면 아래 새 전용 CSS만 허용한다.
- 공용 UI 변경은 담당자 1에게 요청한다.

## 3. 공개 API와 계약

- 외부는 `src/tournament/index.js`만 사용한다.
- 현재 실제 `index.js`는 빈 경계이며 대진 기능은 아직 구현되지 않았다.
- 승인 후 목표 API: `createInitialBracket(config?)`, `getCurrentRound(bracket)`, `getNextOpponent(bracket, teamId)`, `recordMatchResult(bracket, matchResult) -> TournamentBracket`, `validateBracket(bracket)`.
- 입력 bracket을 변경하지 않고 새 TournamentBracket을 반환한다. 내부 전역 상태를 만들지 않으며 저장 상태는 `AppStateV2.tournamentBracket` 하나다.
- match를 import하지 않고 Contracts v1의 plain MatchResult만 입력받는다.

## 4. 절대 금지

- 허용 경로 밖 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리 설치, 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- “팀 결정 필요”인 규모, 팀 데이터, 시드, 무승부·승부차기, 결과 확정·수정·재실행 정책을 임의로 확정하거나 구현하지 않는다.
- 범위 밖 버그·UI·게임 규칙·데이터 형식을 직접 변경하거나 빌드 오류를 이유로 다른 폴더를 수정하지 않는다.
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

- 정책 승인 전에는 빈 공개 경계를 유지하고 특정 토너먼트 규모에 종속된 코드를 만들지 않는다.
- 승인 후 불변 API와 MatchResult 검증을 구현한다.
- 완료 조건: 입력 불변성, 다음 상대·승자 진출 정확성, 잘못된 결과 거부, AppStateV2 단일 저장 원칙, public index 경계, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`; 종료 시 `git diff --check`, `npm run build`.
- 승인된 정책에 한해 bracket 생성, 승자 진출, 승부차기 결과, 완료 경기 재실행·결과 수정 거부를 확인한다.
- 마지막에 변경 파일, 검증 결과, 미검증 정책, 담당자 간 요청 사항을 보고한다.
