# REWIND FC 4인 분업 가이드

## 공통 규칙

- 각자 자신의 담당 폴더만 수정한다.
- 다른 영역은 내부 파일 대신 해당 영역의 `index.js`를 통해 사용한다.
- 담당 밖의 수정이 필요하면 직접 고치지 말고 담당자에게 요청한다.
- `src/shared/**`, `package.json`, `index.html`, `vite.config.js`는 담당자 1이 최종 수정한다.
- 작업 전후 `git diff --name-only`로 담당 밖 파일이 변경되지 않았는지 확인한다.
- PR 전 `npm run build`를 실행한다.

## 담당자 1 — 앱 플랫폼·시작 화면·통합

담당 경로:

- `src/app/**`
- `src/main.js`
- `src/shared/**`
- `index.html`
- `package.json`, `package-lock.json`
- `vite.config.js`
- README, 배포 설정, CI

주요 작업:

- 시작 화면
- 라우팅과 뒤로가기/앞으로가기
- 전역 상태와 `localStorage`
- 공용 UI와 스타일
- 다른 영역의 화면 등록과 최종 통합

브랜치:

```text
feature/app-platform
```

## 담당자 2 — 선수 데이터·명단·전술

담당 경로:

- `src/team/**`

주요 작업:

- 선수 데이터
- 소집 명단과 주장 선택
- 포메이션·선발 11인·전술 설정
- 선수 및 라인업 검증

공개 API:

- `src/team/index.js`
- `src/team/data/index.js`

브랜치:

```text
feature/team-planning
```

## 담당자 3 — 시뮬레이션·되감기

담당 경로:

- `src/simulation/**`

주요 작업:

- 선수와 공의 움직임
- 패스·슛·골·체력 계산
- 포메이션 좌표
- 스냅샷·복원·되감기
- 결정론과 게임 규칙 테스트

주의:

- DOM과 Three.js를 import하지 않는다.
- 외부 공개는 `src/simulation/index.js`만 사용한다.

브랜치:

```text
feature/simulation-rewind
```

## 담당자 4 — 경기 UI·3D 렌더링

담당 경로:

- `src/match/**`

주요 작업:

- 경기 화면과 HUD
- 경기 루프와 키보드 입력
- Three.js 경기장·선수·공
- 카메라 모드
- WebGL 성능과 자원 정리

공개 API:

- `src/match/index.js`
- `src/match/render3d/index.js`

브랜치:

```text
feature/match-3d
```

## 권장 진행 및 병합 순서

병렬 작업:

- 담당자 1: 시작 화면·앱 상태·라우터
- 담당자 2: 명단·전술
- 담당자 3: 시뮬레이션·되감기
- 담당자 4: 경기 UI·3D

병합 순서:

1. `feature/app-platform`
2. `feature/simulation-rewind`
3. `feature/team-planning`
4. `feature/match-3d`
5. 담당자 1이 전체 흐름을 최종 검증하고 통합

## PR 전 확인

```bash
git diff --name-only
git diff --check
npm run build
```

최종 수동 확인 흐름:

```text
시작 화면 → 감독명 입력 → 선수단 선택 → 전술 설정 → 3D 경기 → 되감기
```
