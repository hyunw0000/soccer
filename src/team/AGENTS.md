# Team 영역 작업 규칙

## 소유 역할

담당자 2 — 선수 데이터·명단·전술

## 수정 허용

- `src/team/**`

## 수정 금지

- `src/app/**`
- `src/simulation/**`
- `src/match/**`
- `src/shared/**`
- 루트 설정/배포/공용 문서

## 경계 규칙

- 외부 화면 공개는 `src/team/index.js`를 사용한다.
- 선수 데이터 공개는 `src/team/data/index.js`를 사용한다.
- 앱 상태는 `src/app/public.js`, 공용 UI는 `src/shared/index.js`, 포메이션/필드 규칙은 `src/simulation/index.js`만 import한다.
- 다른 영역의 내부 파일을 직접 import하거나 수정하지 않는다.
