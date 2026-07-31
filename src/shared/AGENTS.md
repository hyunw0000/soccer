# Shared 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **1 — 공용 UI·계약·통합**
- 담당 기능: 디자인 토큰, 공용 버튼·입력·카드·모달, 공용 DOM helper, 공용 assets, Contracts v1 문서/shape.
- 담당하지 않는 기능: 특정 화면 전용 로직, 선수·대진·전술·경기 규칙, 기능별 상태.

## 2. 수정 허용 범위

- 기본 허용: `src/shared/**` 및 그 아래 새 파일.
- 함께 소유: `src/app/**`, `src/main.js`, `index.html`, `vite.config.js`, `package.json`, `package-lock.json`.
- 공용 UI/CSS/assets는 담당자 1만 수정한다.
- 페이지 전용 CSS는 이 폴더에 넣지 않고 해당 기능의 `screens/*.css`에 둔다.

## 3. 공개 API와 계약

- 현재 공용 UI 진입점: `src/shared/index.js`의 `el`, `frag`.
- 계약 위치: `src/shared/contracts/player.js`, `tournament.js`, `match.js`. 현재는 예약 진입점이며 런타임 기능을 제공하지 않는다.
- shared는 app 또는 feature 내부 파일을 import하지 않는다.
- Contracts v1에는 plain data 계약만 두고 기능 로직, singleton, DOM, 저장 상태를 넣지 않는다.
- MatchSetup은 `version: 1`, AppState/localStorage는 `schemaVersion: 2`로 별도 관리한다.

## 4. 절대 금지

- 허용 경로 밖 파일 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, package/lockfile, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리 설치, 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- 범위 밖 버그 직접 수정, 팀 결정 필요 정책 구현, 범위 밖 UI·게임 규칙·데이터 형식 변경을 금지한다.
- 빌드 오류를 이유로 다른 폴더를 수정하지 않는다. 금지 경로가 바뀌면 완료로 보고하지 않는다.

## 5. 담당 범위 밖 변경 요청

직접 수정하지 말고 아래 양식을 마지막 보고의 **담당자 간 요청 사항**에 남긴다.

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

- 공용 요소만 추출하고 특정 기능만 쓰는 코드는 shared로 올리지 않는다.
- 디자인 토큰과 반응형 기준을 유지하고 기능 PR의 UI 일관성을 검수한다.
- 완료 조건: feature/app 역방향 import 없음, 공용 API 문서화, 기존 화면 회귀 없음, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`, 종료 시 `git diff --check`, `npm run build`.
- test/lint 스크립트는 현재 없으므로 필수 명령으로 적지 않는다.
- 마지막에 변경 파일, 검증 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
