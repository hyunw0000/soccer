# App 영역 작업 규칙

## 소유 역할

담당자 1 — 앱 플랫폼·시작 화면·통합

## 수정 허용

- `src/app/**`
- `src/main.js`
- `index.html`
- `vite.config.js`
- `package.json`, `package-lock.json`
- 루트 문서, 배포 설정, CI

## 수정 금지

- `src/team/**`
- `src/simulation/**`
- `src/match/**`
- `src/shared/**`는 통합 담당자가 최종 소유하지만, 기능 작업과 섞지 말고 별도 변경으로 관리한다.

## 경계 규칙

- 기능 영역은 각 영역의 `index.js`를 통해서만 조립한다.
- `app/public.js`만 기능 영역에 공개하며 `app/main.js`를 기능에서 import하지 않는다.
- 화면 이동은 `ctx.navigate()`로만 수행한다.
- 다른 담당 영역의 내부 파일 변경이 필요하면 직접 수정하지 말고 공개 API 변경 요청을 남긴다.
