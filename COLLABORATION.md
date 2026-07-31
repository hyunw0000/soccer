# 4인 병렬 개발 소유권

## 담당 영역

| 담당 | 역할 | 수정 가능 경로 | 권장 브랜치 |
| --- | --- | --- | --- |
| 1 | 앱 플랫폼·시작 화면·통합 | `src/app/**`, `src/main.js`, `src/shared/**`, 루트 앱/빌드/문서/CI 파일 | `refactor/app-platform-integration` |
| 2 | 선수 데이터·명단·전술 | `src/team/**` | `feature/team-planning` |
| 3 | 시뮬레이션·되감기 | `src/simulation/**` | `feature/simulation-rewind` |
| 4 | 경기 UI·3D 렌더링 | `src/match/**` | `feature/match-3d` |

`src/shared/**`는 전원이 사용할 수 있지만 담당자 1만 최종 수정한다. 다른 담당자는 변경 요청만 제출한다.

## 공개 진입점

| 영역 | 공개 진입점 |
| --- | --- |
| 앱 초기화 | `src/app/index.js` |
| 앱 상태 | `src/app/public.js` |
| 공용 UI | `src/shared/index.js` |
| 선수단/전술 화면 | `src/team/index.js` |
| 선수 데이터 | `src/team/data/index.js` |
| 시뮬레이션 | `src/simulation/index.js` |
| 경기 화면 | `src/match/index.js` |
| 경기 3D | `src/match/render3d/index.js` |

다른 영역의 내부 파일을 직접 import하지 않는다.

## 권장 병합 순서

1. `refactor/app-platform-integration`
2. `feature/simulation-rewind`
3. `feature/team-planning`
4. `feature/match-3d`
5. 담당자 1의 최종 통합/문서/배포 PR

## CI 경로 검사 제안

브랜치 또는 PR label별 허용 정규식을 지정하고 `git diff --name-only <base>...HEAD` 결과가 범위를 벗어나면 실패시킨다.

예시:

```bash
git diff --name-only origin/dev...HEAD |
  awk '!/^src\\/simulation\\// {
    print "OUT_OF_SCOPE:", $0
    bad=1
  }
  END { exit bad }'
```

권장 CI 규칙:

- `area:app`: `src/app/**`, `src/main.js`, `src/shared/**`, 허용된 루트/CI 파일
- `area:team`: `src/team/**`
- `area:simulation`: `src/simulation/**`
- `area:match`: `src/match/**`
- `*/index.js` 공개 API 변경은 `interface-change` label과 담당자 1 승인을 추가로 요구
- CODEOWNERS 승인과 경로 검사 CI를 모두 필수화

CODEOWNERS 예시:

```text
/src/app/             @app-owner
/src/main.js          @app-owner
/src/shared/          @app-owner
/src/team/            @team-owner
/src/simulation/      @simulation-owner
/src/match/           @match-owner
/package.json         @app-owner
/package-lock.json    @app-owner
/index.html           @app-owner
/vite.config.js       @app-owner
```
