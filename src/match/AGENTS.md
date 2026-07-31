# Match 영역 작업 규칙

## 소유 역할

담당자 4 — 경기 UI·3D 렌더링

## 수정 허용

- `src/match/**`

## 수정 금지

- `src/app/**`
- `src/team/**`
- `src/simulation/**`
- `src/shared/**`
- 루트 설정/배포/공용 문서

## 경계 규칙

- 경기 화면은 `src/match/index.js`로 공개한다.
- 3D 공개 API는 `src/match/render3d/index.js`로 공개한다.
- 앱 상태는 `src/app/public.js`, 선수 데이터는 `src/team/data/index.js`, 시뮬레이션은 `src/simulation/index.js`만 import한다.
- 화면 이탈 시 RAF, 이벤트 리스너, WebGL 자원을 반드시 정리한다.
