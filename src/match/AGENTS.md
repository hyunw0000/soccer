# Match 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **4 — 경기 UI·3D 렌더링·자원 정리**
- 담당 기능: match 화면/controller, HUD·입력, Three.js 장면·카메라·선수 rig, 경기 lifecycle와 cleanup.
- 담당하지 않는 기능: 선수·대진·포메이션·전술 도메인, 앱 route/state, simulation 결과 규칙의 재계산.

## 2. 수정 허용 범위

- 기본 허용: `src/match/**` 및 그 아래 새 파일.
- 함께 소유: `src/simulation/**`. match 작업 중에는 필요 없이 함께 수정하지 않는다.
- 페이지 CSS: `src/match/screens/match.css`와 match 화면 아래 새 전용 CSS만 허용한다.
- 공용 토큰·UI를 사용하며 공용 시각 체계를 재정의하지 않는다.

## 3. 공개 API와 계약

- 외부 경기 진입점: `src/match/index.js`; 3D 내부 공개점: `src/match/render3d/index.js`.
- 현재 export: `matchScreen`; render3d는 `createMatchView`, `CAM_MODES`.
- 현재 호환 화면은 app state, roster/lineup 공개 API, simulation 공개 API를 조립한다. 목표 MatchSetup 전환 후에는 plain MatchSetup만 받고 roster/lineup/tactics를 import하지 않는다.
- 목표 API `startMatch`, `pauseMatch`, `resumeMatch`, `rewindMatch`, `getMatchState`, `getMatchResult`, `destroyMatch`는 아직 전부 구현된 것이 아니다. 협의 없이 존재한다고 가정하지 않는다.
- renderer는 simulation 상태를 표시만 하며 경기 결과를 결정하지 않는다.

## 4. 절대 금지

- 허용 경로 밖 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리 설치, 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- 범위 밖 버그 직접 수정, 팀 결정 필요 정책 구현, 범위 밖 UI·게임 규칙·선수 데이터 변경을 금지한다.
- renderer에서 점수·승자·경기 규칙을 별도로 계산하지 않는다.
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

- MVP 우선: 시작·일시정지·재개·종료, 기본 3D·기존 카메라, 제한된 되감기, MatchResult 표시, cleanup.
- 고급 카메라·애니메이션·통계·시각 효과·최적화는 MVP 완료 전 시작하지 않는다.
- 화면 이탈 시 RAF, 이벤트 listener, renderer·geometry·material 등 WebGL 자원을 정리한다.
- 완료 조건: 반복 진입 시 중복 loop/listener 없음, renderer가 결과를 변경하지 않음, 페이지 CSS 토큰 준수, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`; 종료 시 `git diff --check`, `npm run build`.
- 시작/일시정지/재개/종료, 되감기, 카메라·입력, 반복 진입/이탈과 WebGL cleanup을 확인한다.
- 마지막에 변경 파일, 검증 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
