# App 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **1 — 앱 플랫폼·시작 화면·통합**
- 담당 기능: 앱 시작, route 등록, `pushState`/`popstate`, 화면 lifecycle, 시작 화면, 전역 상태와 localStorage, 기능 공개 API 조립.
- 담당하지 않는 기능: 선수·대진 도메인, 라인업·전술 규칙, 시뮬레이션, 경기 결과 계산, Three.js 내부 구현.

## 2. 수정 허용 범위

- 기본 허용: `src/app/**` 및 그 아래 새 파일.
- 함께 소유: `src/shared/**`, `src/main.js`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json`.
- 함께 소유한 경로는 해당 작업이 앱 통합·공용 UI·빌드 설정에 명시적으로 포함될 때만 수정한다.
- 페이지 CSS: 시작 화면 전용 CSS가 필요하면 `src/app/screens/**` 안에만 만든다. 공용 CSS는 `src/shared/styles/**`에서 관리한다.
- 다른 기능 화면의 페이지 CSS는 직접 수정하지 않고 최종 UI 검수 결과와 변경 요청만 남긴다.

## 3. 공개 API와 계약

- 외부 조립 진입점: `src/app/index.js`의 `startApp`.
- 기능 영역용 상태 진입점: `src/app/public.js`.
- 현재 실제 export: `state`, `setState`, `resetState`, 호환용 captain 조회 helper.
- 목표 공개 API는 `state`, `setState(patch)`, `resetState()`다. 호환 helper 제거와 AppStateV2 migration은 소비자와 합의한 별도 작업으로 수행한다.
- 화면 이동은 router가 주입하는 `ctx.navigate(routeName, params?, options?)`만 사용한다. route params에 영속 상태를 저장하지 않는다.
- 다른 영역은 `src/roster/index.js`, `src/tournament/index.js`, `src/lineup/index.js`, `src/tactics/index.js`, `src/match/index.js`만 import한다.
- Contracts v1, MatchSetup version 1, AppState schemaVersion 2를 혼용하지 않는다.

## 4. 절대 금지

- 명시된 허용 경로 밖의 파일을 수정하거나 새 파일을 만들지 않는다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 담당자의 파일을 삭제·이동·이름 변경하거나 기존 변경을 되돌리고 덮어쓰지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 해당 영역 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리를 임의로 설치하거나 공개 API를 협의 없이 변경하지 않는다.
- Contracts v1, MatchSetup version 1, AppState schemaVersion 2를 임의로 변경하지 않는다.
- 담당 범위 밖 버그를 직접 수정하거나 “팀 결정 필요” 정책을 임의로 확정·구현하지 않는다.
- 기존 UI, 게임 규칙, 데이터 형식을 담당 범위 밖에서 변경하지 않는다.
- 빌드 오류 해결을 이유로 다른 담당 폴더를 수정하지 않는다.
- 금지 경로가 변경됐다면 작업 완료로 보고하지 않는다.

## 5. 담당 범위 밖 변경 요청

직접 수정하지 말고 파일 경로, 재현 절차, 예상 원인, 필요한 공개 API·데이터 계약, 요청 담당자와 대상 폴더를 기록해 마지막 보고의 **담당자 간 요청 사항**에 남긴다.

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

## 6. 주요 작업과 완료 조건

- route 등록과 cleanup, history, 상태 복원, 앱 조립을 담당한다.
- 기능 내부 로직을 app에 복제하지 않는다.
- 전체 화면 흐름과 공용 UI 준수 여부를 최종 검수한다.
- 완료 조건: 뒤로가기/앞으로가기와 화면 cleanup 정상, 상태 저장·복원 정상, 공개 진입점만 사용, `npm run build` 성공.

## 7. 작업 전후 검증

```bash
git status --short
git diff --name-only
git diff --check
npm run build
```

- 시작 전 기존 변경을 기록하고 종료 후 변경 파일이 허용 범위인지 대조한다.
- 현재 `package.json`에는 test/lint가 없으므로 이를 필수 명령으로 가정하지 않는다.
- 마지막에 변경 파일, 실행한 검증과 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
