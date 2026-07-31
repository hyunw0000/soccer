# REWIND FC 4인 협업 구조 분석 및 분업 설계

> 작성 기준: 현재 `yj1` 작업 트리의 README, 설정 파일, 전체 추적 소스와 에셋을 직접 확인한 결과  
> 문서 목적: 파일 소유권을 겹치지 않게 나누고, 4명이 병렬 개발할 수 있는 구조를 결정한다.  
> 주의: 이 문서는 설계안만 담는다. 아래 B안의 파일 이동은 아직 수행하지 않았다.
>
> **현재 상태:** 이후 실제 리팩터링에서는 요청된 `src/app`, `src/team`, `src/simulation`, `src/match`, `src/shared` 구조를 채택했다. 현재의 최종 소유권과 공개 진입점은 [`COLLABORATION.md`](./COLLABORATION.md)를 기준으로 한다.

## 1. 결론 요약

- 현재 프로젝트는 **브라우저에서 실행되는 3D 축구 감독 시뮬레이터**다.
- 핵심 차별점은 **전술 설정 → 3D 경기 관전 → 8초 되감기 → 전술 재지시** 흐름이다.
- 서버, 로그인, DB, 외부 API 없이 Vite와 Three.js만으로 실행된다.
- 시뮬레이션(`src/engine`)과 3D 표현(`src/render3d`)의 분리는 잘 되어 있다.
- 반면 화면 코드가 `src/screens`에 평면적으로 모여 있고, 모든 화면 스타일이 `src/styles/base.css` 한 파일에 있어 UI 작업 충돌 가능성이 높다.
- `state.js`, `main.js`, `router.js`, `match.js`는 여러 영역을 직접 연결하므로 통합 충돌 지점이다.
- 단기 마감이 매우 가깝다면 A안도 가능하지만, **4명이 계속 병렬 작업할 계획이라면 B안(기능별 모듈 재편)을 추천**한다.
- B안에서는 각 기능이 자신의 `index.js`만 공개하고, 앱 통합 담당자가 의존성을 주입해 조립한다. 기능끼리 다른 기능의 내부 파일을 직접 import하지 않는다.

## 2. 프로젝트 목적과 현재 구현 상태

### 2.1 목적

REWIND FC는 사용자가 대한민국 축구 대표팀 감독이 되어 다음 경험을 하는 동적 웹서비스다.

1. 감독명을 정한다.
2. 선수 풀에서 소집 명단과 주장을 정한다.
3. 상대 포메이션을 보고 포메이션, 선발 11인, 전술 수치를 정한다.
4. 3D 경기를 관전한다.
5. 경기 중 전술을 실시간 변경하거나, 제한된 횟수만큼 과거로 되감아 다른 선택을 한다.

대회 요구사항인 “직접 조작하는 감독 경험”, “실제 월드컵 데이터 참고”, “브라우저에서 바로 실행”을 겨냥한다.

### 2.2 기술 구성

| 구분 | 현재 선택 |
| --- | --- |
| 언어/모듈 | 순수 JavaScript, ES Modules |
| 빌드/개발 서버 | Vite 8 |
| 3D | Three.js 0.160 계열 |
| 상태 저장 | 메모리 객체 + `localStorage` |
| 서버/DB/API | 없음 |
| 배포 | Vercel, Netlify/Cloudflare Pages, GitHub Pages 고려 |
| 테스트 도구 | 없음 |

### 2.3 현재 구현된 것

- 새 시작 화면
  - 경기장 배경 이미지
  - 감독명 입력
  - 전술판 장식 애니메이션
  - 시작 버튼을 통한 다음 화면 전환
- 선수 소집 화면
  - 55명 선수 데이터 표시
  - 포지션 필터
  - 14~23명 소집 검증
  - 주장 지정
  - 최소 포지션 인원 검증
- 전술 화면
  - 4-3-3, 4-4-2, 3-4-3 선택
  - 자동 선발 11인
  - 슬롯별 선수 교체
  - 수비 라인, 압박, 템포, 폭 설정
  - 전술 보드 시각화
- 경기 화면
  - 결정론적 고정 시간 간격 시뮬레이션
  - 홈/원정 22명 이동
  - 공 이동, 패스, 슛, 골, 스코어
  - 체력 소모
  - 방송캠, 탑뷰, 공 추적 카메라
  - 경기 중 전술 슬라이더
  - 8초 되감기, 최대 3회
  - 키보드 단축키 `Space`, `R`
  - 화면 이탈 시 RAF, 이벤트, WebGL 자원 정리
- 데이터/보안/배포
  - 55명 선수 JSON
  - CSP 및 보안 헤더
  - Vercel 설정
  - 상대 경로 기반 정적 빌드
  - 초기 3D 프로토타입 보존

### 2.4 현재 구현 수준 평가

핵심 데모 흐름은 연결되어 있고, 프로토타입으로는 동작 가능한 수준이다. 다만 “제품 완성” 기준에서는 경기 규칙, 상태 일관성, 접근성, 테스트, 결과 화면, 실제 데이터 근거가 아직 부족하다. README에 적힌 “되감기 정확도 테스트”를 재현하는 자동 테스트 파일은 현재 저장소에 없다.

## 3. 실행 흐름과 기능 의존 관계

### 3.1 실행 흐름

```text
index.html
  └─ src/main.js
      ├─ base.css 로드
      ├─ router 생성
      └─ manager 화면 진입
          └─ 감독명 저장
              └─ squad 화면
                  └─ 소집 명단/주장 저장
                      └─ tactics 화면
                          ├─ 포메이션/전술 저장
                          └─ lineupIds를 route params로 전달
                              └─ match 화면
                                  ├─ Sim 생성
                                  ├─ RewindBuffer 생성
                                  ├─ Three.js MatchView 생성
                                  └─ requestAnimationFrame 루프
```

### 3.2 현재 import 의존 방향

```text
main
 ├─ router
 └─ screens/*

screens/*
 ├─ ui/dom
 ├─ state
 ├─ data/players
 ├─ engine/*          (tactics, match)
 └─ render3d/*        (match)

state
 ├─ data/players
 └─ engine/params

render3d/matchView
 ├─ engine/params
 └─ render3d 내부 모듈

engine/sim
 ├─ params, math, rng, entities, formations, steering
 └─ Three.js에는 의존하지 않음
```

### 3.3 중요한 경계

- `engine`은 Three.js와 DOM을 모른다.
- `render3d`는 `Sim`의 숫자 상태를 읽지만 게임 규칙을 결정하지 않는다.
- `matchView.js`가 시뮬레이션 상태와 Three.js를 잇는 어댑터다.
- 현재 화면은 `state`, `data`, `engine`, `render3d`의 내부 파일을 직접 import한다.
- `state.js`도 `data/players.js`, `engine/params.js`를 직접 import해 앱 셸이 도메인 내부에 결합된다.

## 4. 폴더 및 파일 역할

### 4.1 루트/설정

| 파일 | 역할 | 비고 |
| --- | --- | --- |
| `README.md` | 목적, 실행법, 구조, 배포, 보안 설명 | 현재 에셋 사용 여부와 테스트 설명 일부 갱신 필요 |
| `package.json` | 스크립트와 의존성 | 테스트, lint, format 스크립트 없음 |
| `package-lock.json` | 재현 가능한 의존성 잠금 | `package.json` 변경 담당자와 동일 소유 필요 |
| `index.html` | 앱 DOM 루트와 메타데이터 | 앱 셸 공용 파일 |
| `vite.config.js` | 빌드, 청크, 개발 서버 설정 | 통합/배포 공용 파일 |
| `vercel.json` | Vercel 빌드 및 보안 헤더 | `public/_headers`와 정책 동기화 필요 |
| `.env.example` | 향후 환경변수 정책 설명 | 현재 실제 환경변수 없음 |
| `.gitignore` | 의존성, 빌드, 비밀값, 임시 파일 제외 | 협업 규칙 파일을 `plans/`에 두면 무시됨 |
| `SECURITY.md` | 보안 설계와 점검 내용 | 코드 변경 시 동기화 필요 |
| `CLAUDE.md` | 대회 요구사항과 기획 메모 | 개발 정책 파일이라기보다 대회 컨텍스트 |
| `LICENSE` | MIT 라이선스 | 공용 문서 |

### 4.2 에셋/정적 파일

| 경로 | 역할 |
| --- | --- |
| `assets/rewind-stadium-background.png` | 시작 화면 배경 |
| `assets/rewind-stadium-crowd-360.png` | 향후 경기장/360 배경 후보, 현재 앱 코드에서 미사용 |
| `public/_headers` | Netlify/Cloudflare 보안 헤더 |
| `public/legacy/prototype-3d.html` | 초기 CDN 기반 단일 HTML 프로토타입 |

### 4.3 앱 셸/공유

| 파일 | 역할 |
| --- | --- |
| `src/main.js` | CSS와 모든 화면을 import하고 라우터를 시작 |
| `src/router.js` | 화면 전환, 이전 화면 cleanup 실행 |
| `src/state.js` | 세션 상태, `localStorage` 저장/검증, 초기값 |
| `src/ui/dom.js` | `innerHTML` 없이 DOM을 생성하는 공용 헬퍼 |
| `src/styles/base.css` | 시작, 선수, 전술, 경기 화면의 모든 스타일이 모인 단일 파일 |

### 4.4 데이터

| 파일 | 역할 |
| --- | --- |
| `src/data/players_korea.json` | 55명 선수, 포지션, 소속, 더미 능력치 |
| `src/data/players.js` | 번호 부여, 검색, 필터, 기본 명단, 자동 라인업, Sim 메타 변환 |

선수 데이터 형식:

```js
{
  id: string,
  name: string,
  nameEn: string,
  pos: 'GK' | 'DF' | 'MF' | 'FW',
  detail: string,
  club: string,
  age: number,
  captain: boolean,
  squad2026: boolean,
  stats: {
    overall: number,
    attack: number,
    defense: number,
    stamina: number,
    pace: number,
    pass: number,
    shoot: number
  }
}
```

### 4.5 화면

| 파일 | 역할 |
| --- | --- |
| `src/screens/managerName.js` | 시작 화면, 감독명 입력, 전술판 장식 |
| `src/screens/squad.js` | 소집 명단과 주장 선택 |
| `src/screens/tactics.js` | 포메이션, 전술, 선발 11인 선택 |
| `src/screens/match.js` | Sim, rewind, 3D view, HUD, 입력, RAF 루프 통합 |

### 4.6 시뮬레이션

| 파일 | 역할 |
| --- | --- |
| `src/engine/params.js` | 필드, 골대, 물리 상수, 전술 기본값 |
| `src/engine/math.js` | 길이, clamp, lerp |
| `src/engine/rng.js` | 되감기 가능한 시드 난수 |
| `src/engine/formations.js` | 포메이션 슬롯과 월드 좌표 변환 |
| `src/engine/entities.js` | Player, Ball 상태와 기본 물리 |
| `src/engine/steering.js` | arrive, pursuit, separation, closest |
| `src/engine/sim.js` | 경기 규칙, 틱, 패스/슛/골, 스냅샷/복원 |
| `src/engine/rewind.js` | 스냅샷 링버퍼와 과거 분기 |

### 4.7 3D 렌더링

| 파일 | 역할 |
| --- | --- |
| `src/render3d/scene.js` | renderer, scene, camera, light, controls, resize/dispose |
| `src/render3d/pitch.js` | 런타임 잔디 텍스처, 필드, 골대 |
| `src/render3d/playerRig.js` | 선수 리그, 번호, 체력바, 달리기 애니메이션 |
| `src/render3d/cameraRig.js` | 세 가지 카메라 모드 |
| `src/render3d/matchView.js` | Sim 상태를 3D 오브젝트에 반영하는 공개 어댑터 |

## 5. 미구현 및 개선 필요 사항

### 5.1 기능 정합성

- 시작 화면에는 “되감기 30회 지급”이라고 표시하지만 실제 경기는 3회다.
- 시작 화면의 “공격 성공 확률 23%”는 실제 데이터/시뮬레이션 계산이 아닌 장식이다.
- “게임 소개”, “설정” 버튼은 동작하지 않는다.
- 경기 종료 조건, 하프타임, 결과 화면, 재경기 흐름이 없다.
- 교체 기능과 선수별 지시는 없다.
- 상대 선수는 실제 데이터가 아니라 고정 이름/능력치다.
- 스로인, 코너킥, 오프사이드, 파울 등은 없다.
- 전술 화면에서 정한 선발 11인은 route params로만 전달되어 새로고침/직접 진입 시 유지되지 않는다.
- 전술 화면을 나갔다 돌아오면 선발 11인 세부 배치가 자동 구성으로 재생성된다.

### 5.2 버그 가능성/상태 일관성

- `Ball.kick()`이 `ownerKey`를 즉시 `null`로 만들기 때문에 득점자 표시와 공 소유 표시가 대부분 기대대로 동작하지 않을 가능성이 크다.
- `state.load()`는 `formation`이 실제 포메이션 키인지 검증하지 않는다.
- `oppFormation`은 초기 상태에는 있지만 저장/복원 대상이 아니다.
- 로드한 `captainId`가 로드한 `poolIds`에 포함되는지 검증하지 않는다.
- 되감기 스냅샷에는 물리 상태와 점수는 있지만 현재 전술/포메이션 값 자체는 없다. “과거 전술 상태까지 복원”이 요구된다면 계약을 확장해야 한다.
- `events.length`만 스냅샷에 담으므로 장시간 경기에서 50개 제한과 되감기가 함께 작동할 때 사건 기록 의미를 별도 검증해야 한다.
- `router`는 브라우저 URL/history와 연결되지 않아 뒤로가기, 새로고침 복구, 직접 링크를 지원하지 않는다.

### 5.3 품질/테스트

- 자동 테스트가 전혀 없다.
- README가 주장하는 결정론/되감기 테스트를 실행할 테스트 파일과 스크립트가 없다.
- ESLint, formatter, type check/JSDoc check가 없다.
- CI가 없다.
- 브라우저별 시각/상호작용 회귀 테스트가 없다.
- `match.js`가 198줄 안에서 UI, 입력, 루프, 도메인 연결을 모두 담당한다.
- `base.css`가 626줄이며 모든 기능의 스타일을 공유한다.

### 5.4 성능/접근성

- Three.js 청크가 빌드 경고 기준인 500KB를 넘는다.
- 각 선수 리그가 geometry/material/CanvasTexture를 개별 생성하므로 재사용 최적화 여지가 있다.
- 2048 shadow map과 최대 DPR 2는 저사양 모바일에서 부담이 될 수 있다.
- 경기 화면의 모바일 UI는 sidepanel을 숨겨 전술 조작 기능이 사라진다.
- 상단 장식 버튼, 전술판 장식의 접근성 설명과 키보드 흐름을 더 점검해야 한다.
- 색상만으로 팀/상태를 구분하는 부분이 있다.

### 5.5 문서/데이터

- README의 “외부 이미지·폰트·아이콘 에셋을 사용하지 않는다”는 현재 PNG 배경 에셋 사용과 맞지 않는다.
- README에는 자동 테스트가 있는 것처럼 읽히지만 테스트 파일이 없다.
- 선수 소속과 2026 명단 정보의 출처/검증일/라이선스 표기가 더 명확해야 한다.
- `rewind-stadium-crowd-360.png`는 현재 미사용 에셋이다.

## 6. 충돌하기 쉬운 파일

위험도 순:

1. `src/styles/base.css`
   - 4개 화면의 스타일이 모두 한 파일에 있다.
   - UI 담당자가 동시에 수정하면 거의 확실히 충돌한다.
2. `src/screens/match.js`
   - UI, 시뮬레이션, 3D, 입력, 되감기 통합 지점이다.
3. `src/state.js`
   - 모든 화면의 상태 계약과 저장 스키마가 모인다.
4. `src/main.js`
   - 모든 화면 등록과 앱 시작 정책이 모인다.
5. `src/screens/tactics.js`
   - 데이터, 포메이션, 전술, 라인업 UI가 교차한다.
6. `src/data/players.js`
   - 선수 화면, 전술 화면, 경기 어댑터가 모두 사용한다.
7. `src/engine/params.js`
   - 엔진, 상태 초기값, 렌더링이 공유한다.
8. `package.json` / `package-lock.json`
   - 도구 추가 시 반드시 함께 바뀌며 충돌이 잦다.
9. `README.md`, `vercel.json`, `public/_headers`, `vite.config.js`
   - 배포/보안/구조 변경 시 통합 담당자가 최종 동기화해야 한다.

## 7. A안: 현재 폴더 구조 유지

### 7.1 담당자별 역할과 소유 범위

| 담당 | 역할 | 독점 소유 파일/폴더 |
| --- | --- | --- |
| A1 | 앱 셸·시작 UI·통합 | `src/main.js`, `src/router.js`, `src/state.js`, `src/ui/`, `src/styles/base.css`, `src/screens/managerName.js`, 루트 설정/문서/에셋 |
| A2 | 선수 데이터·명단·전술 UI | `src/data/`, `src/screens/squad.js`, `src/screens/tactics.js` |
| A3 | 시뮬레이션·되감기 | `src/engine/` |
| A4 | 3D 경기 경험 | `src/render3d/`, `src/screens/match.js` |

### 7.2 공유 파일과 최종 수정 담당

공유 파일은 “여러 명이 수정”하는 파일이 아니라 “모두 읽고 A1만 수정”하는 파일로 운영한다.

| 공유 파일 | 최종 수정 담당 | 변경 방식 |
| --- | --- | --- |
| `src/main.js`, `src/router.js`, `src/state.js` | A1 | 다른 담당자는 제안만 작성 |
| `src/styles/base.css` | A1 | A2/A4가 필요한 CSS 변경을 A1에게 요청 |
| `package.json`, `package-lock.json` | A1 | 의존성/스크립트 추가 요청을 모아 A1이 반영 |
| `index.html`, `vite.config.js` | A1 | 앱/빌드 변경을 A1이 통합 |
| `README.md`, `SECURITY.md` | A1 | 각 담당자가 문서 변경점을 전달 |
| `vercel.json`, `public/_headers` | A1 | 보안 정책을 동시에 갱신 |

### 7.3 현재 공개 함수와 데이터 형식

A2가 제공:

```js
PLAYERS
findById(id) -> PlayerData | null
byPos(pos) -> PlayerData[]
overall(player) -> number
defaultPool(limit) -> string[]
autoLineup(poolIds, positionNeeds) -> PlayerData[]
toSimMeta(player) -> { id, num, name, pace, stamina }
```

A3가 제공:

```js
new Sim({ lineup, formation, tactics, oppFormation, seed })
sim.step()
sim.snapshot() -> Snapshot
sim.restore(snapshot)
sim.applyTactics(partialTactics)
sim.setFormation(key)

new RewindBuffer(options)
rewind.maybeRecord(sim)
rewind.rewind(seconds) -> Snapshot | null

FORMATIONS
FORMATION_KEYS
positionNeeds(key)
slotPosition(key, index, side, width)
PARAMS
TACTIC_DEFAULT
```

A4가 제공:

```js
createMatchView(container, sim, captainNum)
  -> {
    sync(dt),
    render(),
    setCam(mode),
    camMode,
    dispose()
  }

CAM_MODES
```

A1이 제공:

```js
el(tag, props, children) -> HTMLElement
state
setState(patch)
resetState()
createRouter(root, screens)
ctx.go(screenName, params)
```

### 7.4 예상 순환 의존성과 병합 충돌

- 현재는 명시적 import cycle은 없다.
- 그러나 A1의 `state.js`가 A2 데이터와 A3 전술 기본값에 의존하고, A2/A4 화면이 다시 A1 state에 의존한다. 파일 단위로는 cycle이 아니지만 팀 단위 변경 승인 cycle이 생긴다.
- A2와 A4가 스타일을 직접 고칠 수 없으므로 A1에게 요청이 몰린다.
- A3가 `Sim` 형식을 바꾸면 A4의 `match.js`와 `matchView.js`가 동시에 깨질 수 있다.
- A2가 선수 형식을 바꾸면 A1 state validation과 A4 match adapter도 영향을 받는다.
- 공용 `base.css`를 예외적으로 여러 명이 수정하면 충돌 위험이 매우 높다.

### 7.5 장점

- 이동/리팩터링 없이 즉시 시작할 수 있다.
- import 경로가 바뀌지 않는다.
- 단기 데모 마감에 유리하다.
- 현재 잘 나뉜 `engine`/`render3d` 경계를 그대로 활용한다.

### 7.6 단점

- “자기 폴더 안에서만 작업” 원칙을 완전히 만족하지 못한다.
- A1이 스타일, 상태, 설정, 통합, 시작 화면을 모두 맡아 병목이 된다.
- A2는 두 화면과 데이터가 서로 다른 경로에 흩어져 있다.
- A4는 `screens/match.js`와 `render3d/` 두 경로를 소유한다.
- 내부 파일 직접 import 관행이 계속된다.
- 새 기능이 늘어날수록 `screens`, `base.css`, `state.js`가 더 커진다.

### 7.7 리팩터링 위험

낮다. 대신 구조적 충돌 비용을 계속 지불한다.

### 7.8 추천 여부

**조건부 추천.** 실제 개발 기간이 1~2일이고 구조 변경 자체가 위험한 경우에만 선택한다.

## 8. B안: 4개 담당 영역에 맞춘 기능별 재편

### 8.1 추천 폴더 구조

```text
src/
  app/                              # 담당 1
    index.js                        # 기존 main.js 역할
    router.js
    store.js
    sessionSchema.js
    bootstrap.js                    # 기능 공개 API 조립/의존성 주입
  shared/                           # 담당 1, 전원 읽기 전용
    index.js
    ui/
      dom.js
    styles/
      tokens.css
      reset.css
      layout.css
  features/
    start/                          # 담당 1
      index.js
      startScreen.js
      start.css
      assets/                       # 시작 화면 전용 이미지
    team-planning/                  # 담당 2
      index.js                      # 유일한 외부 진입점
      screens/
        squadScreen.js
        tacticsScreen.js
      domain/
        players.js
        formations.js
        lineup.js
        validators.js
      data/
        players_korea.json
      styles/
        squad.css
        tactics.css
    simulation/                     # 담당 3
      index.js                      # 유일한 외부 진입점
      config.js
      math.js
      rng.js
      entities.js
      steering.js
      simulator.js
      rewindBuffer.js
      snapshotSchema.js
      __tests__/
    match/                          # 담당 4
      index.js                      # 유일한 외부 진입점
      matchScreen.js
      controller/
        matchLoop.js
        inputController.js
      render3d/
        scene.js
        pitch.js
        playerRig.js
        cameraRig.js
        matchView.js
      styles/
        match.css
      __tests__/
index.html                          # 담당 1
package.json / package-lock.json    # 담당 1
vite.config.js                      # 담당 1
```

### 8.2 의존 방향

```text
app
 ├─ shared
 ├─ features/start          (public index만)
 ├─ features/team-planning  (public index만)
 ├─ features/simulation     (public index만)
 └─ features/match          (public index만)

각 feature
 ├─ shared public index
 └─ app이 주입한 dependency

금지:
feature A 내부 → feature B 내부
feature → app 내부
simulation → DOM/Three.js
```

핵심은 화면이 전역 `state`를 직접 import하지 않는 것이다. 앱이 화면 팩토리를 만들 때 store와 필요한 도메인 API를 주입한다.

### 8.3 공개 인터페이스 설계

#### 담당 1: app/shared/start

```js
// src/app/store.js
createSessionStore(initialSession) -> {
  getState() -> Session,
  update(patch) -> Session,
  reset() -> Session,
  subscribe(listener) -> unsubscribe
}

// 화면에 주입되는 공통 ctx
AppContext = {
  navigate(routeName, params?),
  session: {
    getState(),
    update(patch)
  }
}

// src/shared/index.js
export { el, frag }
```

#### 담당 2: team-planning

```js
// src/features/team-planning/index.js
createTeamPlanningFeature({ session, navigate, shared }) -> {
  routes: {
    squad(root, ctx, params),
    tactics(root, ctx, params)
  },
  catalog: PlayerCatalog,
  createInitialTeamPlan() -> TeamPlanDefaults,
  validateTeamPlan(plan) -> ValidationResult,
  toSimulationLineup(lineupIds) -> SimulationPlayerMeta[]
}

PlayerCatalog = {
  list() -> readonly PlayerData[],
  findById(id) -> PlayerData | null,
  byPosition(pos) -> PlayerData[]
}

TeamPlan = {
  poolIds: string[],
  captainId: string,
  formation: FormationKey,
  opponentFormation: FormationKey,
  tactics: Tactics,
  lineupIds: string[]
}
```

#### 담당 3: simulation

```js
// src/features/simulation/index.js
createSimulation(config: SimulationConfig) -> Simulation
createRewindBuffer(options?) -> RewindBuffer
SIMULATION_DEFAULTS

SimulationConfig = {
  lineup: SimulationPlayerMeta[11],
  formation: FormationKey,
  tactics: Tactics,
  opponentFormation: FormationKey,
  seed?: number
}

SimulationPlayerMeta = {
  id: string,
  number: number,
  name: string,
  pace: number,
  stamina: number
}

Tactics = {
  lineHeight: number, // 0..1
  pressing: number,   // 0..1
  tempo: number,      // 0..1
  width: number       // 0..1
}

Simulation public surface = {
  step(),
  snapshot() -> SimulationSnapshot,
  restore(snapshot),
  applyTactics(partialTactics),
  setFormation(key),
  getState() -> readonly SimulationViewState
}

SimulationViewState = {
  tick: number,
  clockSeconds: number,
  matchMinute: number,
  score: { home: number, away: number },
  homePlayers: RenderPlayerState[],
  awayPlayers: RenderPlayerState[],
  ball: RenderBallState,
  events: MatchEvent[]
}
```

`Player` 클래스 인스턴스를 렌더러에 직접 노출하기보다 읽기 전용 view state 형식을 공개하는 것이 장기적으로 안전하다.

#### 담당 4: match

```js
// src/features/match/index.js
createMatchFeature({
  session,
  navigate,
  simulationApi,
  teamPlanningApi,
  shared
}) -> {
  routes: {
    match(root, ctx, params)
  }
}

createMatchView(container, initialViewState, options?) -> {
  sync(viewState, dt),
  render(),
  setCamera(mode),
  dispose()
}
```

### 8.4 담당자별 역할과 소유 범위

| 담당 | 역할 | 독점 소유 |
| --- | --- | --- |
| B1 | 앱 플랫폼·시작 경험·통합 | `src/app/`, `src/shared/`, `src/features/start/`, 루트 설정/문서 |
| B2 | 선수 데이터·명단·전술 | `src/features/team-planning/` |
| B3 | 경기 시뮬레이션·되감기 | `src/features/simulation/` |
| B4 | 경기 UI·3D 렌더링 | `src/features/match/` |

### 8.5 공유 파일과 최종 수정 담당

| 공유 파일 | 최종 수정 담당 |
| --- | --- |
| `src/app/**`, `src/shared/**` | B1 |
| `index.html`, `package.json`, `package-lock.json`, `vite.config.js` | B1 |
| `.gitignore`, `.env.example`, 배포/보안 파일 | B1 |
| `README.md`, 구조 문서, CODEOWNERS, CI | B1 |

다른 담당자는 이 파일을 수정하지 않고 “필요 변경, 이유, 예상 API”를 PR 설명에 남긴다.

### 8.6 예상 순환 의존성과 방지책

위험한 cycle:

```text
app/store → team-planning defaults → team-planning screen → app/store
match → simulation → team-planning formation → match
```

방지:

1. `store`는 특정 기능을 import하지 않는 범용 저장소로 만든다.
2. 초기 세션은 `bootstrap.js`가 각 기능의 public factory 결과를 모아 구성한다.
3. 화면은 `app/store`를 import하지 않고 factory 인자로 session port를 받는다.
4. simulation은 team-planning의 내부 formation을 import하지 않는다.
5. `FormationKey`, `Tactics`, `SimulationPlayerMeta` 계약은 JSDoc typedef 또는 shared contract 문서로 고정한다.
6. 기능 간 호출은 반드시 상대 기능의 `index.js` 공개 API 또는 app이 전달한 포트만 사용한다.

### 8.7 예상 병합 충돌

- 초기 구조 이동 PR은 대부분 파일을 건드리므로 다른 기능 PR보다 먼저 단독 병합해야 한다.
- `package.json`에 테스트 도구를 추가할 때는 B1만 수정해야 한다.
- 공개 `index.js` API 변경은 소비자 브랜치와 충돌할 수 있으므로 제안 → 승인 → B1 통합 순서를 지킨다.
- 기능별 CSS로 분리한 뒤에는 UI 충돌이 크게 줄어든다.
- 공통 토큰 변경은 B1만 수행하므로 시각 변경 요청이 몰릴 수 있지만, 단일 `base.css` 병합 충돌보다는 관리 가능하다.

### 8.8 장점

- 각 담당자가 원칙적으로 자신의 폴더만 수정할 수 있다.
- 스타일도 기능 폴더에 있어 UI 병렬 작업이 가능하다.
- 공개 진입점으로 내부 구현을 숨긴다.
- simulation과 match의 계약 테스트가 쉬워진다.
- 새 기능/화면 추가 시 소유권이 명확하다.
- `match.js`의 거대한 통합 책임을 controller와 renderer로 나눌 수 있다.

### 8.9 단점

- 초기에 파일 이동과 import 변경이 크다.
- 의존성 주입 패턴을 팀원이 함께 이해해야 한다.
- 앱 통합 담당자는 공개 API 조율 책임이 크다.
- 순수 JS라 TypeScript 컴파일러가 계약 위반을 자동으로 모두 잡아주지 못한다.

### 8.10 리팩터링 위험

중간 이상.

- CSS import 순서가 바뀌어 화면이 달라질 수 있다.
- Vite asset URL이 이동 중 깨질 수 있다.
- localStorage schema를 잘못 바꾸면 기존 사용자 상태가 사라질 수 있다.
- 화면 cleanup/RAF/WebGL dispose가 factory 분리 중 누락될 수 있다.
- route params와 lineup 전달이 끊길 수 있다.

완화:

- 첫 PR은 동작 변경 없이 이동/공개 index/기존 API re-export만 한다.
- 구조 이동 전후 `npm run build`와 전체 사용자 흐름 수동 테스트를 수행한다.
- simulation golden test를 먼저 추가한다.
- 기존 localStorage key와 데이터 shape을 구조 이동 단계에서는 유지한다.

### 8.11 추천 여부

**추천.** 4명이 며칠 이상 병렬 개발하거나 이후 기능을 계속 늘릴 계획이면 B안이 더 안전하다.

## 9. A안/B안 비교

| 기준 | A안 | B안 |
| --- | --- | --- |
| 즉시 착수 | 매우 쉬움 | 구조 이동 선행 필요 |
| 자기 폴더만 수정 | 부분 충족 | 거의 완전 충족 |
| CSS 충돌 | 높음 | 낮음 |
| 내부 파일 직접 import | 유지 | 공개 index로 제한 |
| 앱 상태 결합 | 유지 | 포트/주입으로 완화 |
| 단기 마감 위험 | 낮음 | 중간 |
| 장기 병렬 개발 | 불리 | 유리 |
| 테스트 경계 | 불명확 | 기능 단위로 명확 |
| 추천 | 초단기만 | 기본 추천 |

## 10. 추천안(B안) 기준 담당자 상세

### 담당자 1 — 앱 플랫폼·시작 경험·통합

1. **역할명**
   - App Platform & Integration Owner
2. **소유 폴더**
   - `src/app/`
   - `src/shared/`
   - `src/features/start/`
   - 루트 설정/문서/배포 파일
3. **담당 기능과 작업 목표**
   - 앱 부트스트랩, 라우팅, 세션 저장, 공용 DOM/스타일 토큰
   - 시작 화면과 감독명 입력
   - 네 기능의 public API 조립
   - 빌드, CI, 배포, 문서 최종 통합
4. **수정 허용**
   - 위 소유 폴더
   - `index.html`
   - `package.json`, `package-lock.json`
   - `vite.config.js`
   - `.gitignore`, `.env.example`
   - `README.md`, `SECURITY.md`, `CLAUDE.md`, `LICENSE`
   - `vercel.json`, `public/_headers`
   - `.github/**`, `CODEOWNERS`
5. **수정 금지**
   - `src/features/team-planning/**`
   - `src/features/simulation/**`
   - `src/features/match/**`
6. **협의 인터페이스**
   - 각 기능의 `index.js` export
   - `AppContext`, `Session`, route name/params
   - 초기 세션 구성과 persistence schema
7. **구체 작업**
   - 범용 store와 router 구현
   - 화면 factory에 store/navigation 주입
   - 전역 CSS를 shared와 start CSS로 분리
   - 기능 CSS import 순서 정의
   - public API 조립 및 route 등록
   - 테스트/lint 스크립트와 CI 추가
   - README 구조와 실제 동작 동기화
8. **완료 조건/테스트**
   - 앱이 항상 시작 화면에서 열린다.
   - 감독명이 저장되고 squad route로 이동한다.
   - route 전환마다 이전 cleanup이 정확히 1회 실행된다.
   - 새로고침 후 유효한 session만 복원된다.
   - `npm run build`, 단위 테스트, 전체 흐름 smoke test 통과
9. **추천 브랜치**
   - `refactor/app-platform-integration`

### 담당자 2 — 선수 데이터·명단·전술

1. **역할명**
   - Team Planning & Data Owner
2. **소유 폴더**
   - `src/features/team-planning/`
3. **담당 기능과 작업 목표**
   - 선수 카탈로그, 소집 명단, 주장, 포메이션, 선발 11인, 전술 설정
   - 데이터 검증과 Simulation용 라인업 변환
4. **수정 허용**
   - `src/features/team-planning/**`만
5. **수정 금지**
   - `src/app/**`, `src/shared/**`, `src/features/start/**`
   - `src/features/simulation/**`, `src/features/match/**`
   - 루트/설정/배포 파일
6. **협의 인터페이스**
   - `TeamPlan`, `PlayerData`, `SimulationPlayerMeta`
   - `createTeamPlanningFeature()`
   - `catalog`, `validateTeamPlan()`, `toSimulationLineup()`
   - formation key와 tactics shape
7. **구체 작업**
   - 선수 데이터 schema validator
   - 선수 조회 인덱스(Map)로 반복 선형 검색 개선
   - 명단/주장 검증을 UI 밖의 순수 함수로 분리
   - 선발 11인 중복/포지션 요구 검증
   - lineupIds를 session에 저장하도록 공개 patch 형식 제공
   - squad/tactics 스타일을 기능 CSS로 이동
   - 팀 계획 도메인 단위 테스트
8. **완료 조건/테스트**
   - 14~23명, 포지션 최소 수, 주장 포함 조건 테스트
   - 각 포메이션이 정확히 11개 슬롯과 올바른 요구 수량을 제공
   - 자동 라인업에 중복 선수가 없음
   - 동일 입력에 동일 라인업 결과
   - 잘못된 ID/formation/tactics가 명확한 validation error를 반환
   - 기능 폴더 외 변경이 없음
9. **추천 브랜치**
   - `feature/team-planning-domain`

### 담당자 3 — 경기 시뮬레이션·되감기

1. **역할명**
   - Simulation & Rewind Owner
2. **소유 폴더**
   - `src/features/simulation/`
3. **담당 기능과 작업 목표**
   - 순수 경기 규칙과 물리
   - 결정론, 스냅샷, 복원, 되감기 정확도
   - 렌더러가 사용할 안정적인 view state
4. **수정 허용**
   - `src/features/simulation/**`만
5. **수정 금지**
   - 다른 모든 `src` 기능/앱/공용 폴더
   - 루트/설정/배포 파일
6. **협의 인터페이스**
   - `SimulationConfig`, `SimulationPlayerMeta`
   - `Tactics`, `FormationKey`
   - `SimulationSnapshot`, `SimulationViewState`, `MatchEvent`
   - `createSimulation()`, `createRewindBuffer()`
7. **구체 작업**
   - 현재 Sim 모듈을 public factory 뒤에 캡슐화
   - `ownerKey`/득점자/소유권 의미 수정 제안 및 구현
   - snapshot에 반드시 필요한 상태 목록 명시
   - 동일 seed 결정론 테스트
   - snapshot → step N → restore → step N 동등성 테스트
   - 링버퍼 경계, 용량, 과거 분기 테스트
   - tactics/formation rewind 정책을 명확히 결정하고 테스트
   - renderer용 읽기 전용 view state 제공
8. **완료 조건/테스트**
   - Three.js/DOM import 0개
   - 동일 seed/config의 상태 hash가 반복 실행에서 동일
   - 되감기 후 동일 입력 재생 시 상태가 정확히 동일
   - 버퍼가 capacity를 넘어도 올바른 과거를 반환
   - 골/스코어/이벤트/득점자 테스트 통과
   - 기능 폴더 외 변경이 없음
9. **추천 브랜치**
   - `feature/deterministic-simulation`

### 담당자 4 — 경기 UI·3D 렌더링

1. **역할명**
   - Match Experience & 3D Owner
2. **소유 폴더**
   - `src/features/match/`
3. **담당 기능과 작업 목표**
   - 경기 화면, HUD, 입력, 카메라, Three.js 장면, 선수 리그
   - simulation public state를 시각화
   - WebGL 성능과 cleanup 안정성
4. **수정 허용**
   - `src/features/match/**`만
5. **수정 금지**
   - `src/app/**`, `src/shared/**`, `src/features/start/**`
   - `src/features/team-planning/**`, `src/features/simulation/**`
   - 루트/설정/배포 파일
6. **협의 인터페이스**
   - `SimulationViewState`, `MatchEvent`
   - simulation commands: `step`, `restore`, `applyTactics`
   - team-planning의 `toSimulationLineup`
   - app의 `navigate`, session read port
7. **구체 작업**
   - `matchScreen`, `matchLoop`, `inputController`, `matchView` 분리
   - RAF와 fixed timestep 단위 테스트 가능한 구조로 분리
   - 3D 리소스 dispose 검증
   - geometry/material/texture 재사용 검토
   - 저사양용 품질 옵션
   - 모바일 전술 조작 UI
   - 카메라 모드와 키보드 입력 접근성 개선
   - 경기 종료/결과 화면 요구사항은 app과 인터페이스 제안
8. **완료 조건/테스트**
   - 화면 진입/이탈 반복 시 RAF와 keydown listener가 누적되지 않음
   - WebGL renderer와 scene 자원이 dispose됨
   - 세 카메라 모드가 동작
   - simulation 내부 클래스/파일을 직접 import하지 않음
   - `createMatchView.sync(viewState, dt)` 계약만 사용
   - 모바일/데스크톱 smoke test 통과
   - 기능 폴더 외 변경이 없음
9. **추천 브랜치**
   - `feature/match-3d-experience`

### 10.1 작업량 균형

| 담당 | 주 작업량 |
| --- | --- |
| B1 | 앱 셸, 시작 화면, 공용 UI, 설정, CI, 통합 |
| B2 | 두 화면, 선수 데이터/검증, 포메이션/라인업 |
| B3 | 시뮬레이션 8개 모듈, 결정론/되감기 테스트 |
| B4 | 경기 화면, 루프/입력, 3D 5개 모듈, 성능/cleanup |

B1은 코드 모듈 수가 상대적으로 적지만 CI, 문서, 통합, 공개 계약 조정까지 맡는다. B2는 두 개의 큰 UI와 데이터를 맡고, B3/B4는 각각 순수 엔진과 3D 경기 경험을 맡아 전체 작업량을 비슷하게 맞춘다.

## 11. 담당자별 Codex 작업 프롬프트

아래 프롬프트는 B안 구조 이동이 완료된 뒤 각 브랜치에서 별도로 사용한다.

### 프롬프트 1 — 앱 플랫폼·시작 경험·통합

```text
당신은 REWIND FC의 App Platform & Integration 담당자다.

소유/허용 범위:
- src/app/**
- src/shared/**
- src/features/start/**
- index.html
- package.json, package-lock.json
- vite.config.js
- .gitignore, .env.example
- README.md, SECURITY.md, CLAUDE.md, LICENSE
- vercel.json, public/_headers
- .github/**, CODEOWNERS

금지 범위:
- src/features/team-planning/**
- src/features/simulation/**
- src/features/match/**

목표:
- 앱 부트스트랩, 라우터, 세션 store, 시작 화면, 공용 UI를 안정화한다.
- 다른 세 기능은 각 index.js의 공개 API로만 조립한다.
- 기능 내부 파일을 직접 import하지 않는다.

필수 규칙:
1. 허용 목록에 있는 파일과 폴더만 수정할 것.
2. 담당 범위 밖에서 문제가 발견되어도 직접 수정하지 말고 보고할 것.
3. 공용 인터페이스 변경이 필요하면 구현하지 말고 변경 제안으로 남길 것.
4. 작업 시작 전과 종료 후 git diff --name-only로 변경 파일을 확인할 것.
5. 허용 범위 밖의 파일이 변경되었다면 작업 완료로 처리하지 말 것.
6. 다른 담당자의 기존 변경을 되돌리지 말 것.
7. 마지막에 변경 파일과 테스트 결과를 보고할 것.

작업 전:
- git status --short
- git diff --name-only
- 현재 public index API와 기존 변경을 확인한다.

완료 기준:
- npm run build 및 관련 테스트 통과
- route cleanup과 localStorage validation 검증
- 금지 범위 변경 0개
- 최종 응답에 변경 파일, 테스트 명령, 결과, 범위 밖 이슈, 인터페이스 제안을 구분해 보고
```

### 프롬프트 2 — 선수 데이터·명단·전술

```text
당신은 REWIND FC의 Team Planning & Data 담당자다.

소유/허용 범위:
- src/features/team-planning/**

금지 범위:
- 위 폴더를 제외한 저장소 전체

목표:
- 선수 카탈로그, 소집 명단, 주장, 포메이션, 선발 11인, 전술 설정을 구현/개선한다.
- 외부에는 src/features/team-planning/index.js만 공개한다.
- 다른 기능의 내부 파일을 직접 import하지 않는다.

필수 규칙:
1. 허용 목록에 있는 파일과 폴더만 수정할 것.
2. 담당 범위 밖에서 문제가 발견되어도 직접 수정하지 말고 보고할 것.
3. 공용 인터페이스 변경이 필요하면 구현하지 말고 변경 제안으로 남길 것.
4. 작업 시작 전과 종료 후 git diff --name-only로 변경 파일을 확인할 것.
5. 허용 범위 밖의 파일이 변경되었다면 작업 완료로 처리하지 말 것.
6. 다른 담당자의 기존 변경을 되돌리지 말 것.
7. 마지막에 변경 파일과 테스트 결과를 보고할 것.

작업 전:
- git status --short
- git diff --name-only
- team-planning public index와 AppContext 계약을 확인한다.

완료 기준:
- 명단/주장/포지션/라인업 validation 테스트 통과
- 잘못된 데이터가 명확한 오류로 처리됨
- 공개 API 외 내부 import를 소비자에게 요구하지 않음
- npm run build 통과
- 금지 범위 변경 0개
- 최종 응답에 변경 파일, 테스트 결과, 범위 밖 이슈, 인터페이스 제안을 보고
```

### 프롬프트 3 — 경기 시뮬레이션·되감기

```text
당신은 REWIND FC의 Simulation & Rewind 담당자다.

소유/허용 범위:
- src/features/simulation/**

금지 범위:
- 위 폴더를 제외한 저장소 전체

목표:
- DOM/Three.js에 의존하지 않는 결정론적 경기 시뮬레이션과 되감기를 구현/검증한다.
- 외부에는 src/features/simulation/index.js만 공개한다.
- SimulationConfig, SimulationViewState, Snapshot 계약을 지킨다.

필수 규칙:
1. 허용 목록에 있는 파일과 폴더만 수정할 것.
2. 담당 범위 밖에서 문제가 발견되어도 직접 수정하지 말고 보고할 것.
3. 공용 인터페이스 변경이 필요하면 구현하지 말고 변경 제안으로 남길 것.
4. 작업 시작 전과 종료 후 git diff --name-only로 변경 파일을 확인할 것.
5. 허용 범위 밖의 파일이 변경되었다면 작업 완료로 처리하지 말 것.
6. 다른 담당자의 기존 변경을 되돌리지 말 것.
7. 마지막에 변경 파일과 테스트 결과를 보고할 것.

작업 전:
- git status --short
- git diff --name-only
- simulation public index와 소비자 계약을 확인한다.

완료 기준:
- 동일 seed/config 결정론 테스트 통과
- snapshot/restore/rewind 재생 동등성 테스트 통과
- 골, 점수, 이벤트, 소유권 테스트 통과
- DOM/Three.js import 0개
- npm run build 통과
- 금지 범위 변경 0개
- 최종 응답에 변경 파일, 테스트 결과, 범위 밖 이슈, 인터페이스 제안을 보고
```

### 프롬프트 4 — 경기 UI·3D 렌더링

```text
당신은 REWIND FC의 Match Experience & 3D 담당자다.

소유/허용 범위:
- src/features/match/**

금지 범위:
- 위 폴더를 제외한 저장소 전체

목표:
- 경기 화면, RAF 루프, 입력, HUD, Three.js 장면과 리소스 lifecycle을 구현/개선한다.
- 외부에는 src/features/match/index.js만 공개한다.
- simulation은 공개 SimulationViewState/command API로만 사용한다.
- simulation 또는 team-planning의 내부 파일을 직접 import하지 않는다.

필수 규칙:
1. 허용 목록에 있는 파일과 폴더만 수정할 것.
2. 담당 범위 밖에서 문제가 발견되어도 직접 수정하지 말고 보고할 것.
3. 공용 인터페이스 변경이 필요하면 구현하지 말고 변경 제안으로 남길 것.
4. 작업 시작 전과 종료 후 git diff --name-only로 변경 파일을 확인할 것.
5. 허용 범위 밖의 파일이 변경되었다면 작업 완료로 처리하지 말 것.
6. 다른 담당자의 기존 변경을 되돌리지 말 것.
7. 마지막에 변경 파일과 테스트 결과를 보고할 것.

작업 전:
- git status --short
- git diff --name-only
- match public index, SimulationViewState, AppContext 계약을 확인한다.

완료 기준:
- 화면 반복 진입/이탈 시 RAF/listener/WebGL 자원 누수 없음
- 카메라 3종과 입력 동작
- 데스크톱/모바일 smoke test
- npm run build 통과
- 금지 범위 변경 0개
- 최종 응답에 변경 파일, 테스트 결과, 범위 밖 이슈, 인터페이스 제안을 보고
```

## 12. 권장 작업 순서

### 12.1 구조 재편 단계

1. **모든 현재 변경을 먼저 커밋하거나 별도 브랜치에 보존**
   - 구조 이동 중 기존 UI 변경과 섞이지 않게 한다.
2. **B1이 구조 전환 PR을 단독 수행**
   - 파일 이동
   - 기능별 `index.js` 생성
   - 기존 API re-export
   - CSS 파일 분리
   - import 경로 수정
   - 이 단계에서는 기능 동작을 바꾸지 않는다.
3. **구조 전환 PR 병합 후 네 브랜치를 새로 생성**
4. **공개 계약 v1 문서/typedef 고정**
5. **네 담당자가 각 폴더에서 병렬 작업**
6. **B1이 통합 브랜치에서 전체 흐름 검증**

### 12.2 기능 개발 우선순위

1. B3: simulation 결정론/되감기 테스트와 소유권 버그
2. B2: TeamPlan/lineup persistence와 validation
3. B4: match controller가 공개 simulation API만 사용하도록 전환
4. B1: session/router/feature 조립과 전체 UX
5. 전원: 접근성, 성능, 문서, 배포 smoke test

## 13. 병렬로 진행 가능한 작업

구조 전환 PR과 계약 v1 병합 후:

- B1: 시작 화면, router/store, CI
- B2: 선수/명단/전술 순수 도메인과 UI
- B3: simulation/rewind와 단위 테스트
- B4: Three.js 렌더링 최적화, camera, lifecycle 테스트

조건부 병렬:

- B4의 match controller 전환은 B3의 `SimulationViewState` 계약이 확정된 뒤 진행한다.
- B1의 초기 session 구성은 B2의 `createInitialTeamPlan()`과 B3의 defaults 계약이 확정된 뒤 마무리한다.

## 14. 권장 브랜치 병합 순서

```text
1. refactor/feature-boundaries          # B1, 구조 이동만
2. feature/deterministic-simulation     # B3
3. feature/team-planning-domain         # B2
4. feature/match-3d-experience          # B4
5. refactor/app-platform-integration    # B1 최종 조립/문서/CI
```

이유:

- simulation 계약이 match의 기반이다.
- team-planning이 SimulationPlayerMeta를 생산한다.
- match는 두 계약을 소비한다.
- app 통합은 최종 public API를 조립한다.

각 PR은 최신 통합 브랜치를 rebase/merge한 뒤 테스트하고, 다음 PR 병합 전에 공개 API 변경 여부를 기록한다.

## 15. 담당 범위 밖 파일 변경 검사

### 15.1 기본 명령

작업 시작:

```bash
git status --short
git diff --name-only
git diff --name-only --cached
```

작업 종료:

```bash
git diff --name-only
git diff --name-only --cached
git diff --check
```

브랜치 전체 변경:

```bash
git diff --name-only origin/dev...HEAD
```

### 15.2 담당자별 허용 범위 검사 예시

B2:

```bash
git diff --name-only origin/dev...HEAD \
  | awk '!/^src\\/features\\/team-planning\\// { print "OUT_OF_SCOPE:", $0; bad=1 } END { exit bad }'
```

B3:

```bash
git diff --name-only origin/dev...HEAD \
  | awk '!/^src\\/features\\/simulation\\// { print "OUT_OF_SCOPE:", $0; bad=1 } END { exit bad }'
```

B4:

```bash
git diff --name-only origin/dev...HEAD \
  | awk '!/^src\\/features\\/match\\// { print "OUT_OF_SCOPE:", $0; bad=1 } END { exit bad }'
```

B1은 허용 경로가 여러 개이므로 CI 스크립트에서 정규식 목록으로 관리한다.

주의:

- 기존 작업 트리에 다른 사람의 미커밋 변경이 있으면 `git diff --name-only`만으로 자신의 변경과 구분하기 어렵다.
- 각 담당자는 깨끗한 worktree/브랜치에서 시작하는 것이 가장 안전하다.
- 다른 담당자의 변경을 제거하기 위해 `git checkout --`, `git reset --hard`를 사용하지 않는다.

## 16. CODEOWNERS와 CI 경계 검증

### 16.1 CODEOWNERS 예시

```text
# 앱/공용/설정 — 통합 담당
/src/app/                         @app-owner
/src/shared/                      @app-owner
/src/features/start/              @app-owner
/index.html                       @app-owner
/package.json                     @app-owner
/package-lock.json                @app-owner
/vite.config.js                   @app-owner
/.github/                         @app-owner
/README.md                        @app-owner
/SECURITY.md                      @app-owner
/vercel.json                      @app-owner
/public/_headers                  @app-owner

# 기능 담당
/src/features/team-planning/      @team-planning-owner
/src/features/simulation/         @simulation-owner
/src/features/match/              @match-owner
```

GitHub branch protection 권장:

- `dev`/기본 브랜치 직접 push 금지
- PR 필수
- CODEOWNER review 필수
- CI 통과 필수
- stale approval dismiss
- conversation resolution 필수

### 16.2 CI 경계 검사 아이디어

`.github/ownership-map.json` 예:

```json
{
  "app": [
    "src/app/**",
    "src/shared/**",
    "src/features/start/**",
    "index.html",
    "package*.json",
    "vite.config.js",
    ".github/**",
    "README.md",
    "SECURITY.md",
    "vercel.json",
    "public/_headers"
  ],
  "team-planning": ["src/features/team-planning/**"],
  "simulation": ["src/features/simulation/**"],
  "match": ["src/features/match/**"]
}
```

검증 방식:

1. PR label을 `area:app`, `area:team-planning`, `area:simulation`, `area:match` 중 하나로 강제한다.
2. CI가 base SHA와 head SHA 사이 변경 파일을 구한다.
3. label에 대응하는 glob 밖 파일이 있으면 실패한다.
4. public API 변경(`*/index.js`, shared contracts)은 `interface-change` label과 통합 담당 승인도 요구한다.
5. `package.json`, lockfile, app/shared 파일은 항상 app owner 승인을 요구한다.

CI 기본 작업:

```yaml
- npm ci
- npm run build
- npm test
- npm run lint
- ownership boundary check
```

현재는 `test`/`lint` 스크립트가 없으므로 B1이 도구를 선정하고 추가해야 한다. 의존성 추가 전에는 Node 내장 test runner(`node --test`)로 simulation/domain 테스트를 시작하면 변경 비용을 줄일 수 있다.

### 16.3 import 경계 검사

ESLint를 도입한다면 `no-restricted-imports` 또는 `eslint-plugin-boundaries`로 다음을 강제한다.

- `src/features/*`는 다른 feature의 내부 경로 import 금지
- 다른 feature를 사용할 때는 `src/features/<name>/index.js`만 허용
- feature에서 `src/app/**` import 금지
- simulation에서 `three`, DOM 관련 모듈 import 금지
- match 외 기능에서 `three` import 금지

간단한 CI `rg` 검사도 가능하다.

```bash
# feature 내부 경로를 직접 가리키는 ../other-feature/... 패턴을 탐지
rg -n \"from ['\\\"].*features/(start|team-planning|simulation|match)/.+['\\\"]\" src/features
```

정확한 경계 검사는 import parser 기반 ESLint가 더 안전하다.

## 17. 최종 권고

1. 마감까지 1~2일뿐이면 A안으로 소유권만 강제한다.
2. 그보다 시간이 있고 4명이 실제로 병렬 개발한다면 B안을 채택한다.
3. B안의 첫 구조 PR은 **동작 변경 없이** 이동과 re-export만 한다.
4. 구조 PR 병합 전에는 다른 기능 개발 PR을 시작하지 않는다.
5. 이후에는 각 기능의 `index.js`만 계약으로 취급한다.
6. `main.js`, state/store, router, `package.json`, `index.html`, shared 파일은 통합 담당자만 최종 수정한다.
7. 자동 테스트의 첫 대상은 simulation 결정론/되감기, 두 번째는 team plan validation, 세 번째는 match lifecycle이다.
8. CODEOWNERS는 리뷰 책임을, CI ownership check는 실제 변경 범위를 강제하도록 둘 다 사용한다.
