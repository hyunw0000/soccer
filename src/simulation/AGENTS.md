# Simulation 영역 작업 규칙

## 소유 역할

담당자 3 — 시뮬레이션·되감기

## 수정 허용

- `src/simulation/**`

## 수정 금지

- `src/app/**`
- `src/team/**`
- `src/match/**`
- `src/shared/**`
- 루트 설정/배포/공용 문서

## 경계 규칙

- 외부에는 `src/simulation/index.js`만 공개한다.
- DOM, 브라우저 UI, Three.js를 import하지 않는다.
- 순수 숫자 상태와 결정론을 유지한다.
- 공개 상태/스냅샷 형식 변경이 필요하면 소비 영역과 먼저 협의하고 직접 수정 범위를 넓히지 않는다.
