# REWIND FC 4인 병렬 개발 계획

> 기준: 현재 저장소의 `README.md`, `package.json`, `src/` 전체 구조와 import 관계  
> 목적: 전체 UI, 선수·대진, 라인업·전술, 경기·시뮬레이션을 네 명이 독립적으로 개발한다.  
> 현재 단계: **설계 문서만 작성한다. 이 문서에 적힌 파일 이동과 코드 변경은 아직 수행하지 않는다.**

## 1. 현재 구조 분석

현재 앱 흐름:

```text
시작 화면
→ 감독명 저장
→ 선수 소집과 주장 선택
→ 선발 11명·포메이션·전술 설정
→ 3D 경기
→ 일시정지·실시간 전술 변경·되감기
```

현재 영역:

| 현재 경로         | 역할                                                |
| ----------------- | --------------------------------------------------- |
| `src/app/`        | 앱 초기화, 라우터, 상태, 시작 화면                  |
| `src/shared/`     | 공용 DOM 헬퍼와 전체 스타일                         |
| `src/team/`       | 선수 데이터, 선수 소집, 선발 라인업, 포메이션, 전술 |
| `src/simulation/` | 경기 규칙, 선수·공 이동, 포메이션 좌표, 되감기      |
| `src/match/`      | 경기 화면과 Three.js 렌더링                         |

현재 구조에서 새 분업안과 맞지 않는 부분:

- `src/team/`에 담당자 2의 선수 선발과 담당자 3의 라인업·전술이 함께 있다.
- 대진표와 경기 결과에 따른 다음 상대 결정 기능이 없다.
- `simulation/formations.js`가 포메이션 정의(정규화 좌표)와 월드 좌표 변환을 함께 소유하고, 전술 화면과 `Sim`이 모두 직접 사용한다.
- 현재 경기 화면은 완성된 `MatchSetup` 대신 route params의 `lineupIds`와 전역 `state.formation`, `state.tactics`, `state.oppFormation`을 조합해 `new Sim()`을 호출한다.
- 원본 선수 JSON의 실제 필드는 `pos`, `detail`이고 등번호 `num`은 `players.js`가 로드할 때 파생한다.
- `state.js`는 `managerName`, `poolIds`, `captainId`, `formation`, `tactics`만 저장한다. `oppFormation`, 선발 배치, 교체 명단, 대진 상태는 현재 복원되지 않는다.
- router는 `ctx.navigate()`와 `pushState`/`popstate`를 제공하지만 route params는 새로고침 후 복원되지 않으므로 선택 상태의 단일 출처가 될 수 없다.
- 전체 CSS가 `src/shared/styles/base.css` 한 파일에 있어 담당자 2~4가 직접 수정하면 충돌한다.
- `app/state.js`가 선수 데이터와 시뮬레이션 기본값을 직접 참조한다.
- `match/screens/match.js`가 상태, 선수 데이터, 시뮬레이션, 3D를 함께 조립한다.

## 2. 추천 최종 구조

```text
src/
├── app/                          # 담당자 1
│   ├── index.js
│   ├── main.js
│   ├── public.js
│   ├── router.js
│   ├── state.js
│   └── screens/
│       └── managerName.js
├── shared/                       # 담당자 1
│   ├── index.js
│   ├── contracts/
│   │   ├── player.js
│   │   ├── tournament.js
│   │   └── match.js
│   ├── ui/
│   ├── styles/
│   └── assets/
├── roster/                       # 담당자 2
│   ├── index.js
│   ├── data/
│   │   ├── index.js
│   │   ├── players.js
│   │   └── players_korea.json
│   ├── domain/
│   │   ├── selection.js
│   │   └── validation.js
│   └── screens/
│       ├── roster.js
│       └── roster.css            # 담당자 2, 페이지 전용
├── tournament/                   # 담당자 2
│   ├── index.js
│   ├── data/
│   ├── domain/
│   │   ├── bracket.js
│   │   └── progression.js
│   └── screens/
│       ├── tournament.js
│       └── tournament.css        # 담당자 2, 페이지 전용
├── lineup/                       # 담당자 3
│   ├── index.js
│   ├── formations.js             # 포메이션 정의와 정규화 슬롯의 단일 출처
│   ├── domain/
│   │   ├── lineup.js
│   │   ├── roles.js
│   │   └── validation.js
│   └── screens/
│       ├── lineup.js
│       └── lineup.css            # 담당자 3, 페이지 전용
├── tactics/                      # 담당자 3
│   ├── index.js
│   ├── defaults.js
│   ├── domain/
│   │   └── tactics.js
│   └── screens/
│       ├── tactics.js
│       └── tactics.css           # 담당자 3, 페이지 전용
├── simulation/                   # 담당자 4
│   ├── index.js
│   ├── coordinates.js            # MatchSetup 정규화 좌표 → 월드 좌표
│   ├── entities.js
│   ├── math.js
│   ├── params.js
│   ├── rewind.js
│   ├── rng.js
│   ├── sim.js
│   └── steering.js
├── match/                        # 담당자 4
│   ├── index.js
│   ├── screens/
│   │   ├── match.js
│   │   └── match.css             # 담당자 4, 페이지 전용
│   └── render3d/
│       ├── index.js
│       ├── cameraRig.js
│       ├── matchView.js
│       ├── pitch.js
│       ├── playerRig.js
│       └── scene.js
└── main.js                       # 담당자 1
```

### 구조 조정 이유

- `team`을 `roster`, `lineup`, `tactics`로 분리해 담당자 2와 3의 소유권을 겹치지 않게 한다.
- 아직 없는 대진표 기능은 `tournament`로 독립시킨다.
- `simulation`과 `match`는 담당자 4가 함께 소유하지만 내부적으로 순수 엔진과 Three.js 경계를 유지한다.
- 공통 데이터 형식만 `shared/contracts`에 둔다. 기능 구현은 shared에 넣지 않는다.
- 전체 UI 토큰과 공용 컴포넌트는 담당자 1만 수정한다.
- 담당자 2~4는 자기 기능의 `screens/*.css`만 수정할 수 있다. 페이지 CSS는 담당자 1의 토큰과 공용 UI를 사용하며 색상, 폰트, 버튼, 카드 체계를 재정의하지 않는다.
- 포메이션은 **A안**을 채택한다. 담당자 3의 `lineup/formations.js`가 포메이션 정의와 정규화 슬롯을 한 번만 소유한다.
- 담당자 3은 배치 완료 시 `x`, `z`가 포함된 assignment를 `MatchSetup`에 값으로 복사한다.
- simulation은 lineup/tactics의 내부 파일뿐 아니라 공개 `index.js`도 import하지 않고 plain data인 `MatchSetup`만 입력받는다.
- simulation의 `coordinates.js`는 전달받은 정규화 좌표를 필드 크기, 진영 방향, 전술 폭에 맞는 월드 좌표로 변환한다.

### 포메이션 소유안 선택

선택: **A. 포메이션 정의와 정규화 슬롯 생성은 lineup이 소유**

이유:

1. 포메이션 키, 설명, 역할별 슬롯은 경기 전에 사용자가 선택하고 배치하는 도메인이다.
2. shared가 정의를 소유하면 기능 규칙이 담당자 1에게 묶여 담당자 3의 독립 작업이 어려워진다.
3. UI용/시뮬레이션용 정의를 분리하면 역할, 슬롯 순서, 좌표가 달라질 위험이 있다.
4. `MatchSetup`에 최종 좌표를 값으로 복사하면 중복 정의 없이 담당자 3과 4의 코드 의존을 제거할 수 있다.
5. simulation은 포메이션 ID를 해석하지 않고 이미 확정된 assignment 좌표만 좌표계에 맞춰 변환한다.

금지 의존:

```text
simulation → lineup/index.js
simulation → lineup/formations.js
simulation → tactics/index.js
simulation → roster/index.js
```

허용 데이터 흐름:

```text
roster public data
→ lineup이 포메이션·정규화 슬롯·선수 배치 확정
→ tactics가 전술을 결합해 MatchSetup 생성
→ app 또는 match controller가 MatchSetup을 simulation에 전달
→ simulation이 입력 검증 후 월드 좌표로 변환
```

## 3. 현재 파일 이동 매핑

| 현재 경로                                         | 목표 경로                                                                   | 담당 |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ---- |
| `src/main.js`                                     | 유지                                                                        | 1    |
| `src/app/**`                                      | 유지                                                                        | 1    |
| `src/shared/**`                                   | 유지                                                                        | 1    |
| `src/team/data/players.js`                        | `src/roster/data/players.js`                                                | 2    |
| `src/team/data/players_korea.json`                | `src/roster/data/players_korea.json`                                        | 2    |
| `src/team/data/index.js`                          | `src/roster/data/index.js`                                                  | 2    |
| `src/team/screens/squad.js`                       | `src/roster/screens/roster.js`                                              | 2    |
| `src/team/screens/tactics.js`                     | `src/lineup/screens/lineup.js` 또는 `src/tactics/screens/tactics.js`로 분리 | 3    |
| `src/simulation/formations.js`                    | `src/lineup/formations.js`                                                  | 3    |
| `src/simulation/formations.js`의 `slotPosition()` | 제거 후 `src/simulation/coordinates.js`에서 assignment 좌표 변환            | 4    |
| `src/simulation/params.js`의 `TACTIC_DEFAULT`     | `src/tactics/defaults.js`로 이동                                            | 3    |
| 나머지 `src/simulation/**`                        | 유지                                                                        | 4    |
| `src/match/**`                                    | 유지                                                                        | 4    |

### 그대로 유지해야 하는 파일

- `src/main.js`
- `src/app/main.js`
- `src/app/router.js`
- `src/app/state.js`
- `src/app/screens/managerName.js`
- `src/shared/ui/dom.js`
- `src/shared/styles/base.css`
- `src/simulation`의 순수 물리·되감기 모듈
- `src/match/render3d` 내부 모듈
- `index.html`, `vite.config.js`, `package.json`

### `formations.js` 이전 절차

현재 `simulation/sim.js`가 `slotPosition()`을 직접 사용하므로 단순 파일 이동만 하면 안 된다.

1. 담당자 3이 기존 `FORMATIONS`의 키, 설명, 역할, 정규화 `x`, `z`를 그대로 `lineup/formations.js`로 옮긴다.
2. 각 슬롯에 배열 순서와 무관한 안정적인 `slotId`를 추가한다.
3. lineup이 `StartingLineup.assignments`에 `playerId`, `slotId`, `role`, `x`, `z`를 저장한다.
4. tactics가 이 값을 포함한 완전한 `MatchSetup`을 생성한다.
5. 담당자 4가 `Sim` 생성자를 `MatchSetup` 기반으로 변경한 뒤 `slotPosition()` import를 제거한다.
6. simulation은 `formationId`를 표시/기록용으로만 보관하고 좌표 조회에는 사용하지 않는다.
7. 경기 중 포메이션 변경은 새로운 assignments 전체를 전달하는 `applyMatchPlan({ lineup, tactics })` 형태로 처리한다.

전환 기간에도 simulation이 lineup을 import하는 임시 코드를 만들지 않는다. 기존 입력을 신규 계약으로 바꾸는 임시 어댑터가 필요하면 담당자 1의 앱 통합 계층 또는 담당자 4의 match controller에 두고 제거 시점을 명시한다.

## 4. 담당자별 최종 소유권

### 담당자 1 — 앱 플랫폼·전체 UI·통합

소유:

- `src/app/**`
- `src/shared/**` — 특히 `src/shared/ui/**`, `src/shared/styles/**`, `src/shared/assets/**`는 담당자 1만 수정
- `src/main.js`
- `index.html`
- `package.json`, `package-lock.json`
- `vite.config.js`
- README 및 협업 문서
- 배포와 CI 설정

담당:

- 시작 화면과 감독명
- 라우팅, history, 화면 cleanup
- 전역 상태와 localStorage
- 전체 디자인 토큰
- 공용 버튼, 입력창, 카드, 모달
- 색상, 폰트, 간격, 그림자와 반응형 기준
- 전체 화면 UI 일관성 검수
- 모든 기능 PR의 최종 UI 검수
- 공개 API 최종 연결

수정 금지:

- 다른 담당자의 기능 로직
- `roster`, `tournament`, `lineup`, `tactics`, `simulation`, `match` 내부 구현

브랜치:

```text
feature/app-ui-platform
```

### 담당자 2 — 선수 선발·선수 데이터·대진표

소유:

- `src/roster/**`
- `src/tournament/**`
- 위 폴더의 `screens/*.css` 페이지 전용 스타일

담당:

- 선수 검색, 필터, 정렬, 상세 능력치
- 선수 선택/해제
- 선택 인원과 포지션 검증
- 최종 출전 명단
- 대진표와 라운드
- 현재/다음 상대
- 경기 결과 반영과 다음 대진 갱신

수정 금지:

- `src/shared/ui/**`, `src/shared/styles/**`, `src/shared/assets/**`
- 색상, 폰트, 버튼, 카드 등 공용 시각 체계의 재정의
- 라인업과 전술 내부
- 경기 결과 계산

UI 규칙:

- `roster.css`, `tournament.css`는 공용 디자인 토큰과 공용 UI를 사용한다.
- 새 공용 컴포넌트나 토큰이 필요하면 담당자 1에게 요청하고 직접 shared를 수정하지 않는다.

브랜치:

```text
feature/roster-tournament
```

### 담당자 3 — 선발 라인업·포메이션·경기 전 전술

소유:

- `src/lineup/**`
- `src/tactics/**`
- 위 폴더의 `screens/*.css` 페이지 전용 스타일

담당:

- 선발 11명과 교체 선수
- 포지션과 특수 역할
- 포메이션
- 선수 배치
- 공격/압박/수비 라인/폭
- 경기 설정 검증과 `MatchSetup` 생성

수정 금지:

- 선수 원본 데이터
- 대진표
- 시뮬레이션과 Three.js 내부
- `src/shared/ui/**`, `src/shared/styles/**`, `src/shared/assets/**`
- 색상, 폰트, 버튼, 카드 등 공용 시각 체계의 재정의

UI 규칙:

- `lineup.css`, `tactics.css`는 공용 디자인 토큰과 공용 UI를 사용한다.
- 새 공용 컴포넌트나 토큰이 필요하면 담당자 1에게 요청한다.

브랜치:

```text
feature/lineup-formation
```

### 담당자 4 — 경기·시뮬레이션·3D·되감기

소유:

- `src/simulation/**`
- `src/match/**`
- `src/match/screens/*.css` 페이지 전용 스타일

담당:

- 경기 규칙과 실제 진행
- 선수·공 이동
- 패스, 슛, 골, 체력
- 경기 루프와 HUD 상태
- Three.js 장면
- 카메라와 입력
- snapshot/restore/rewind
- 경기 종료와 결과 생성
- WebGL 및 이벤트 정리

수정 금지:

- 선수 선택과 대진표 내부
- 라인업/전술 내부
- `src/shared/ui/**`, `src/shared/styles/**`, `src/shared/assets/**`
- 색상, 폰트, 버튼, 카드 등 공용 시각 체계의 재정의

UI 규칙:

- `match.css`는 공용 디자인 토큰과 공용 UI를 사용한다.
- 새 공용 컴포넌트나 토큰이 필요하면 담당자 1에게 요청한다.

브랜치:

```text
feature/match-simulation
```

## 5. 공개 진입점과 API

### 앱/공용

```js
// src/app/public.js
state;
setState(patch);
resetState();

// src/shared/index.js
el(tag, props, children);
frag(children);
```

`navigate()`는 현재처럼 `app/public.js` 전역 함수가 아니라 router가 각 화면에 전달하는 `ctx.navigate(routeName, params?, options?)`로 유지한다. route params는 화면 전환용 임시값이며 선수/대진/라인업의 영속 상태를 담지 않는다.

현재 실제 `app/public.js`에는 captain 조회 헬퍼가 있고 `app/state.js`가 선수 조회를 위해 team 데이터를 import하지만, 목표 구조에서는 둘 다 제거한다. captain 선수 객체가 필요한 기능은 `state.selectedSquad.captainId`를 읽고 `roster/index.js`의 `findById(playerId)`를 호출한다. app은 선수 객체를 조회하거나 roster 데이터를 import하지 않는다.

### Roster

```js
// src/roster/index.js
PLAYERS
findById(playerId)
byPos(position)
overall(player)
defaultPool(limit?)
validateSelectedSquad(selectedSquad)
toSimulationPlayer(player)
```

선택/해제는 전역 singleton을 roster 내부에 하나 더 만들지 않고 AppStateV2의 `selectedSquad.playerIds`, `selectedSquad.captainId`를 화면이 갱신한다. roster는 선수 조회와 검증을 순수 함수로 제공한다.

### Tournament

```js
// src/tournament/index.js
createInitialBracket(config?)
getCurrentRound(bracket)
getNextOpponent(bracket, teamId)
recordMatchResult(bracket, matchResult) -> TournamentBracket
validateBracket(bracket)
```

`TournamentBracket`은 `AppStateV2.tournamentBracket`에만 저장한다. tournament 내부에는 별도 singleton이나 전역 상태를 만들지 않는다. 위 함수는 모두 전달받은 값을 기준으로 동작하는 순수 API이며, 특히 `recordMatchResult()`는 입력 `bracket`을 직접 변경하지 않고 새로운 `TournamentBracket`을 반환한다.

### Lineup

```js
// src/lineup/index.js
FORMATIONS
getFormation(formationId)
getNormalizedSlots(formationId)
positionNeeds(formationId)
autoLineup(playerIds, formationId, playerCatalog)
assignPlayer(startingLineup, playerId, slotId) -> StartingLineup
validateStartingLineup(startingLineup, selectedSquad)
```

### Tactics

```js
// src/tactics/index.js
TACTIC_DEFAULT
validateTactics(tactics)
createMatchSetup({
  selectedSquad,
  startingLineup,
  tactics,
  opponent,
  tournamentRef,
  playerCatalog
}) -> MatchSetup
```

### Simulation

```js
// src/simulation/index.js
createSimulation(matchSetup)
createRewindBuffer(options?)
normalizedToWorld({ x, z }, { side, width })
```

simulation의 public API나 내부 파일은 lineup/tactics를 import하지 않는다. `createSimulation()`은 입력 `MatchSetup`의 버전, 11개 assignment, 좌표 범위, player meta, tactics 범위를 자체 검증한다.

### Match

```js
// src/match/index.js
startMatch(matchSetup)
pauseMatch()
resumeMatch()
rewindMatch(seconds?)
getMatchState()
getMatchResult()
destroyMatch()
```

### 영역 간 의존성 원칙

- simulation은 roster, lineup, tactics의 내부 파일과 공개 `index.js`를 모두 import하지 않고 완성된 plain JSON `MatchSetup`만 받는다.
- tournament는 match를 import하지 않고 Contracts v1의 plain `MatchResult`만 받는다.
- 그 밖의 영역 간 호출은 상대 영역의 내부 파일이 아니라 공개 `index.js`를 사용한다.
- `src/shared/contracts/**`에는 데이터 계약과 검증 가능한 shape만 두고 기능 로직이나 전역 상태를 넣지 않는다.
- 화면 이동은 router가 주입하는 `ctx.navigate()`만 사용한다.
- route params는 일시적 화면 전달값이며 영속 상태를 저장하지 않는다.
- `AppStateV2`가 저장 상태의 단일 출처이며 `TournamentBracket`도 오직 `AppStateV2.tournamentBracket`에 저장한다.

### 라우트 계약

| route | 화면 | 진입 조건 |
| --- | --- | --- |
| `manager` | 감독명 설정 | 없음 |
| `roster` | 선수 선택 | 감독명 입력 완료 |
| `tournament` | 대진표 확인 | 출전 명단 확정 |
| `lineup` | 선발 11명·포메이션 | 출전 명단 확정 및 상대 결정 |
| `tactics` | 세부 전술 | 유효한 선발 11명과 포메이션 존재 |
| `match` | 3D 경기 | 유효한 `MatchSetup` 존재 |

라우트 운영 규칙:

- 담당자 1은 `manager`와 전체 route 등록·guard를 소유한다.
- 담당자 2는 `roster`, `tournament` 화면을 공개한다.
- 담당자 3은 `lineup`, `tactics` 화면을 공개한다.
- 담당자 4는 `match` 화면을 공개한다.
- 화면 이동은 router가 전달하는 `ctx.navigate(routeName, params?, options?)`만 사용하며 각 화면이 다른 화면을 직접 렌더링하지 않는다.
- route params에는 영속 상태를 저장하지 않고 선수 선택, 대진표, 라인업, 전술, `MatchSetup`은 `AppStateV2`에 저장한다.
- URL 직접 접근, 뒤로가기, 앞으로가기에도 진입 조건을 검사한다.
- 조건을 충족하지 못하면 준비가 필요한 가장 가까운 이전 route로 `replace` 이동한다.
- 알 수 없는 route는 `manager`로 `replace` 이동한다.
- 이전 화면으로 돌아갈 때 선택값은 `AppStateV2`에서 복원한다.
- `match` 이탈 시 `destroyMatch()`를 호출하고 재진입 시 RAF, 이벤트 리스너, WebGL 인스턴스가 중복되지 않게 한다.

권장 guard 이동:

```text
감독명 없음 → manager
명단 미확정 → roster
상대 미결정 → tournament
라인업 미완성 → lineup
전술 또는 MatchSetup 무효 → tactics
모든 조건 충족 → match
```

## 6. 영역 간 데이터 스키마 — Contracts v1

이 절의 공용 도메인 형식 전체를 **Contracts v1**이라 부른다. `MatchSetup.version`과 저장 상태의 `AppState.schemaVersion`은 서로 다른 버전 축이므로 혼용하지 않는다.

### RawPlayer — 현재 JSON 원본

현재 `players_korea.json`에 실제로 저장된 형식이다. `num`은 JSON에 없고 로드 시 파생된다.

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

### Player — roster 공개 형식

```js
{
  ...RawPlayer,
  num: number // players.js의 assignNumbers()가 1..99 범위로 파생
}
```

필드명을 `number`, `position`, `detailPosition`으로 임의 변경하지 않는다. 변경이 필요하면 별도 migration과 모든 소비자 수정을 동반해야 한다.

### SimulationPlayer — MatchSetup 경계용

현재 `toSimMeta()`가 제공하는 최소 필드와 맞춘다.

```js
{
  id: string,
  num: number,
  name: string,
  pace: number,
  stamina: number
}
```

### SelectedSquad

```js
{
  playerIds: string[],
  captainId: string | null,
  isConfirmed: boolean,
}
```

`minPlayers`, `maxPlayers`, validation 결과는 저장 데이터가 아니라 roster 규칙/함수의 결과로 둔다. 현재 규칙은 최소 14명, 최대 23명이며 최소 포지션 수는 GK 1, DF 3, MF 3, FW 2다.

### Opponent

```js
{
  id: string,
  name: string,
  code: string,
  formationId: string,
  style: string,
  strength: number,
  players: SimulationPlayer[],
  lineup: StartingLineup,
  tactics: Tactics
}
```

### TournamentBracket

```js
{
  tournamentId: string,
  currentRoundId: string,
  rounds: [
    {
      id: string,
      label: string,
      matches: [
        {
          id: string,
          homeTeamId: string | null,
          awayTeamId: string | null,
          status: 'pending' | 'ready' | 'playing' | 'finished',
          result: MatchResult | null,
          nextMatchId: string | null
        }
      ]
    }
  ]
}
```

대진표 기능은 현재 프로젝트에 없으며 담당자 2가 신규 구현한다. 대진표의 저장 상태는 `AppStateV2.tournamentBracket` 하나뿐이다.

### 대진표 제품 정책

아래에서 확정되지 않은 항목은 구현 전에 팀이 결정해야 한다. 추천 기본값은 병렬 개발용 fixture와 초기 구현 기준이며 팀 승인 전에는 확정 정책으로 간주하지 않는다.

| 항목                     | 결정 상태    | 추천 기본값                                              |
| ------------------------ | ------------ | -------------------------------------------------------- |
| 대회 규모                | 팀 결정 필요 | 16강 단일 토너먼트                                       |
| 상대 팀 데이터           | 팀 결정 필요 | `src/tournament/data/teams.json`                         |
| 대한민국 초기 대진 위치  | 팀 결정 필요 | 고정 seed 슬롯 1, 새 게임마다 동일                       |
| 라운드 구조              | 팀 결정 필요 | 16강 → 8강 → 4강 → 결승                                  |
| 무승부                   | 팀 결정 필요 | 연장 없이 승부차기                                       |
| 승부차기 결과 형식       | 팀 결정 필요 | `MatchResult.decision: 'penalties'`, `penaltyScore` 필수 |
| 경기 결과 확정 시점      | 팀 결정 필요 | 결과 확인 화면에서 사용자가 확인할 때                    |
| 저장                     | 팀 결정 필요 | `AppStateV2.tournamentBracket`과 localStorage            |
| 새 게임                  | 팀 결정 필요 | 기존 대진표를 버리고 `createInitialBracket()`으로 초기화 |
| 종료 경기 재실행         | 팀 결정 필요 | 금지, 결과 보기만 허용                                   |
| 경기 중 되감기           | 팀 결정 필요 | 남은 횟수와 보유 snapshot 범위 안에서 허용               |
| 경기 종료 후 되감기      | 팀 결정 필요 | 금지                                                     |
| 대진표 반영 후 결과 수정 | 팀 결정 필요 | 금지                                                     |

### Formation

```js
{
  id: '4-3-3' | '4-4-2' | '3-4-3' | string,
  label: string,
  description: string,
  slots: [
    {
      slotId: string,
      role: 'GK' | 'DF' | 'MF' | 'FW',
      x: number, // -0.5..0.5 정규화
      z: number  // -0.5..0.5 정규화
    }
  ]
}
```

Formation 식별자는 `formation.id`, 슬롯 식별자는 `slot.slotId`를 사용한다. `slotId`는 배열 순서가 바뀌어도 유지되는 안정적인 값이며 `StartingLineup.assignments[].slotId`가 같은 값을 참조한다.

### StartingLineup

```js
{
  formationId: string,
  assignments: [
    {
      slotId: string,
      playerId: string,
      role: 'GK' | 'DF' | 'MF' | 'FW',
      x: number, // -0.5..0.5 정규화
      z: number  // -0.5..0.5 정규화
    }
  ],
  substituteIds: string[],
  captainId: string | null,
  goalkeeperId: string | null,
}
```

좌표 규칙:

- 홈/원정 모두 “자기 진영에서 상대 진영으로 공격”하는 정규화 좌표를 전달한다.
- `x`, `z`는 `[-0.5, 0.5]` 범위다.
- 진영 반전, 필드 미터 변환, width 적용은 simulation의 `normalizedToWorld()`가 담당한다.
- validation 결과는 저장하지 않고 `validateStartingLineup()` 호출 결과로 계산한다.

### Tactics

```js
{
  lineHeight: number, // 0..1
  pressing: number,   // 0..1
  tempo: number,      // 0..1
  width: number       // 0..1
}
```

### MatchSetup

`MatchSetup`은 Contracts v1 안의 경기 입력 계약이며 자체 버전은 **version 1**이다.

```js
{
  version: 1,
  matchId: string,
  seed: number,
  homeTeam: {
    id: string,
    code: string,
    players: SimulationPlayer[],
    lineup: StartingLineup,
    tactics: Tactics
  },
  awayTeam: {
    id: string,
    code: string,
    players: SimulationPlayer[],
    lineup: StartingLineup,
    tactics: Tactics
  },
  tournament: {
    tournamentId: string,
    roundId: string,
    bracketMatchId: string
  }
}
```

`MatchSetup.homeTeam.lineup`과 `awayTeam.lineup`에는 최소한 다음 값이 반드시 들어간다.

```js
{
  formationId: string,
  assignments: [
    {
      playerId: string,
      slotId: string,
      role: 'GK' | 'DF' | 'MF' | 'FW',
      x: number,
      z: number
    }
  ]
}
```

simulation은 roster, lineup, tactics를 import해서 누락된 정보를 조회하지 않는다. 시작에 필요한 선수 메타, 양 팀 assignment, 전술이 모두 없으면 `createSimulation()`이 오류를 반환한다.

### AppStateV2 — 목표 localStorage 형식

AppState/localStorage의 저장 스키마 버전은 **schemaVersion 2**다. Contracts v1이나 MatchSetup version 1과 독립적으로 migration한다.

현재 v1은 `managerName`, `poolIds`, `captainId`, `formation`, `tactics`만 저장한다. 새 구조에서는 plain JSON만 저장하고 feature 클래스/함수는 넣지 않는다.

```js
{
  schemaVersion: 2,
  managerName: string,
  selectedSquad: SelectedSquad,
  tournamentBracket: TournamentBracket,
  currentOpponentId: string | null,
  startingLineup: StartingLineup | null,
  tactics: Tactics,
  pendingMatchSetup: MatchSetup | null
}
```

`app/state.js`는 roster나 simulation 내부 구현을 import해 값을 채우지 않는다. 각 기능의 public validator/default factory를 앱 조립 단계에서 주입하거나, 저장값이 없을 때 app이 각 public factory를 호출해 초기 상태를 만든다.

### MatchState

```js
{
  status: 'idle' | 'running' | 'paused' | 'finished',
  tick: number,
  matchMinute: number,
  score: { home: number, away: number },
  possessionPlayerId: string | null,
  homePlayers: [
    {
      playerId: string,
      num: number,
      x: number,
      z: number,
      heading: number,
      energy: number
    }
  ],
  awayPlayers: [],
  ball: {
    x: number,
    z: number,
    vx: number,
    vz: number
  },
  events: [
    {
      id: string,
      minute: number,
      type: string,
      team: 'home' | 'away',
      text: string
    }
  ],
  rewindsLeft: number
}
```

### MatchResult

```js
{
  matchId: string,
  bracketMatchId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  winnerTeamId: string | null,
  decision: 'regular' | 'extra-time' | 'penalties',
  penaltyScore: {
    home: number,
    away: number
  } | null,
  endedAtTick: number,
  events: MatchState['events'],
  stats: {
    possessionHome: number,
    shotsHome: number,
    shotsAway: number
  }
}
```

추천 정책에서는 정규시간 동점이면 연장 없이 승부차기로 결정한다. 이 경우 `decision`은 `'penalties'`, `penaltyScore`는 양 팀 점수를 가지며 `winnerTeamId`는 승부차기 승자다. 정규시간 승부는 `decision: 'regular'`, `penaltyScore: null`이다. `'extra-time'`은 향후 팀이 연장전을 채택할 경우를 위한 계약 값이다.

## 7. 예외 상황 처리

| 상황                                      | 책임 영역               | 처리                                                                                 |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| 선수가 충분하지 않음                      | roster                  | `validateSelectedSquad()`가 오류 반환, 다음 화면 차단                                |
| 골키퍼가 없음                             | roster                  | 포지션 오류 반환                                                                     |
| 선발 11명 미완성                          | lineup                  | `validateStartingLineup()` 실패                                                      |
| 같은 선수가 두 슬롯에 배치                | lineup                  | 중복 playerId 오류                                                                   |
| MatchSetup에 선수 메타·슬롯·좌표가 누락됨 | tactics/simulation 경계 | `createMatchSetup()` 또는 `createSimulation()`이 명시적 오류 반환                    |
| 정규화 좌표가 범위를 벗어남               | lineup                  | MatchSetup 생성 전에 좌표 검증 실패                                                  |
| 주장이 출전 명단에 없음                   | roster/lineup           | 양쪽 경계에서 검증                                                                   |
| 상대가 아직 결정되지 않음                 | tournament              | `getNextOpponent()`가 `null`, 경기 설정 차단                                         |
| 정규시간 동점                             | match/tournament        | 추천 정책에 따라 승부차기를 수행하고 `decision`, `penaltyScore`, `winnerTeamId` 검증 |
| 승부차기 결과 누락·동점                   | tournament              | `recordMatchResult()`가 결과를 거부하고 새 bracket을 생성하지 않음                   |
| 완료 경기 재실행                          | tournament/app          | 추천 정책상 진입 차단, 결과 보기만 허용                                              |
| 경기 도중 뒤로가기                        | match/app               | match cleanup 후 상태 저장 여부 정책 적용                                            |
| 경기 종료 후 대진표 갱신                  | match → tournament      | `MatchResult`를 `recordMatchResult()`에 전달                                         |
| 경기 종료 후 되감기                       | match                   | 추천 정책상 거부                                                                     |
| 반영 완료 결과 수정                       | tournament              | 추천 정책상 거부, 입력 bracket도 변경하지 않음                                       |
| 이전 페이지로 복귀                        | app state               | 선택값을 전역 상태에서 복원                                                          |
| 새로고침                                  | app state               | schema validation 후 localStorage 복원                                               |
| localStorage 손상                         | app                     | 기본 상태로 복구                                                                     |
| 되감기 기록 부족                          | simulation              | 가능한 가장 오래된 snapshot 또는 실패 결과 반환                                      |

## 8. 담당자별 작업 목록과 완료 조건

### 담당자 1

작업:

- 디자인 토큰 정의
- 공용 UI 컴포넌트 정리
- 시작 화면 유지·개선
- 새 route 등록
- 전역 상태 schema와 migration
- 기능 API 조립
- 전체 UI 검수
- 색상·폰트·간격·그림자·반응형과 공용 버튼·입력창·카드·모달 관리
- 기능 PR의 페이지 전용 CSS 최종 검수
- CI 경로 검사

완료 조건:

- 모든 화면이 공용 디자인 기준을 사용
- 뒤로가기/앞으로가기와 cleanup 정상
- 새로고침 후 상태 복원
- 기능 로직을 직접 수정하지 않음
- `npm run build` 성공

테스트:

- router/history, route guard, 뒤로가기/앞으로가기 수동 검증
- localStorage 정상/손상 데이터 수동 검증
- 전체 사용자 흐름 수동 테스트
- 모바일/데스크톱 UI 확인
- 테스트 환경 도입 후 router, route guard, AppState migration 단위 테스트

예상 난이도: 중상  
예상 작업량: 약 25% — 앱, UI 시스템, 상태, 라우팅, 통합

### 담당자 2

작업:

- roster 데이터와 API
- 검색/정렬/필터
- 선택 검증
- 대진 데이터와 토너먼트 진행
- 팀이 승인한 대회 규모와 라운드 정책에 따른 토너먼트 구현
- 추천 기본안은 16강 단일 토너먼트이지만 정책 승인 전에는 특정 규모에 종속된 대진 생성·화면 구현을 시작하지 않음
- `createInitialBracket(config?)`가 승인된 대회 설정을 입력받도록 구현
- 다음 상대 계산
- MatchResult 반영
- 무승부·승부차기 결과 검증
- AppStateV2의 bracket을 입력받아 새 bracket을 반환하는 불변 API
- roster/tournament 페이지 전용 CSS 작성

완료 조건:

- 잘못된 명단을 확정할 수 없음
- 대진 상대가 없으면 경기 진입 차단
- 경기 결과가 다음 라운드에 정확히 반영
- tournament 내부 전역 상태 없이 AppStateV2만 저장 상태로 사용
- 입력 bracket을 직접 변경하지 않음
- public index 외 내부 파일을 노출하지 않음

테스트:

- 인원/포지션/GK 검증
- 선택/해제
- 대진 승자 진출
- 무승부 처리 정책
- 승부차기 점수와 winner 검증
- 완료 경기 재실행과 결과 수정 차단
- 저장/복원 데이터 테스트
- 페이지 CSS의 공용 토큰 사용과 shared 재정의 여부 검수

예상 난이도: 중상  
예상 작업량: 약 20~25% — 선수 데이터, 선수 선택, 신규 대진표

### 담당자 3

작업:

- 선발/교체 선수
- 포메이션 데이터
- 슬롯 배치
- 주장/GK 역할
- 전술 설정
- MatchSetup 생성
- lineup/tactics 페이지 전용 CSS 작성

완료 조건:

- 정확히 11명, 중복 없음
- GK와 주장 유효
- 포메이션 슬롯 수 일치
- 모든 전술 값이 0..1
- 유효한 MatchSetup만 생성

테스트:

- 미완성/중복 라인업
- 포메이션 변경 시 재배치
- 선수 교환
- MatchSetup schema
- roster API mock 기반 테스트
- 페이지 CSS의 공용 토큰 사용과 shared 재정의 여부 검수

예상 난이도: 중상  
예상 작업량: 약 20~25% — 라인업, 포메이션, 전술, MatchSetup

### 담당자 4

MVP 작업:

- 기존 시뮬레이션 동작 유지
- MatchSetup 입력 방식으로 전환
- MatchSetup 정규화 좌표의 월드 좌표 변환
- 경기 시작, 일시정지, 재개, 종료
- 기본 3D 경기와 기존 카메라 유지
- 횟수와 snapshot 범위가 제한된 되감기
- `decision`과 `penaltyScore`를 포함한 MatchResult 생성
- RAF, 이벤트 리스너, WebGL cleanup
- match 페이지 전용 CSS 작성

후속 작업:

- 고급 선수 AI
- 고급 패스와 슈팅 판단
- 추가 카메라 연출
- 추가 선수 애니메이션
- 상세 경기 통계
- 고급 성능 최적화
- 추가 시각 효과

MVP 완료 전에는 후속 작업을 시작하지 않는다.

완료 조건:

- 동일 seed 결정론
- 되감기 복원 정확
- 경기 종료 결과 생성
- 동점 시 추천 승부차기 계약을 만족하는 결과 생성
- renderer가 결과를 결정하지 않음
- `src/lineup/**`, `src/tactics/**`, `src/roster/**`를 import하지 않음
- 이탈 후 RAF/listener/WebGL 누수 없음

테스트:

- simulation 단위 테스트
- snapshot/restore 동등성
- 골/스코어/종료
- 정규시간 승리와 승부차기 MatchResult
- 경기 종료 후 되감기 거부
- MatchResult schema
- 화면 반복 진입/이탈
- 카메라와 입력 smoke test
- match.css의 공용 토큰 사용과 shared 재정의 여부 검수

예상 난이도: 높음  
예상 작업량: 약 30~35% — 시뮬레이션, 3D, 되감기, 경기 결과, 자원 정리

위 네 작업량 수치는 정확히 100%로 합산하기 위한 값이 아니라 현재 코드와 신규 기능을 기준으로 한 예상 범위다. 상세 정책과 구현 난이도에 따라 달라질 수 있다.

## 9. 병렬 작업과 선후 관계

### 먼저 확정

1. Contracts v1 데이터 스키마
2. MatchSetup version 1
3. AppState schemaVersion 2와 기존 상태 migration
4. 각 영역 `index.js` 공개 API
5. route 이름과 진입 조건
6. 대진표, 경기 종료와 무승부 정책

### 병렬 가능

- 담당자 1: 디자인 시스템과 앱 상태
- 담당자 2: roster 검증과 tournament 도메인
- 담당자 3: lineup 검증과 formation/tactics
- 담당자 4: 확정된 MatchSetup fixture를 입력으로 simulation 테스트와 3D 최적화

### 의존 순서

```text
공용 계약 확정
├─ roster/tournament API
├─ lineup/tactics MatchSetup 생성
└─ MatchSetup fixture 기반 match/simulation 구현
→ lineup/tactics와 match/simulation 계약 통합
→ tournament 결과 반영
→ app 최종 통합
```

담당자 4는 담당자 2·3의 구현 완료를 기다리지 않고 shared의 `MatchSetup` 계약과 고정 fixture만으로 작업한다. 런타임 객체를 받는 경계에서도 plain JSON `MatchSetup`만 사용하며 roster, lineup, tactics의 내부 또는 public `index.js`를 import하지 않는다.

## 10. 병합 순서

1. `feature/app-ui-platform`
   - Contracts v1, MatchSetup version 1, AppState schemaVersion 2와 route 뼈대
2. `feature/roster-tournament`
   - 선수와 대진 공개 API
3. `feature/lineup-formation`
   - MatchSetup 생성
4. `feature/match-simulation`
   - 실제 경기와 MatchResult
5. 담당자 1 최종 UI·통합 PR

## 11. 충돌 가능 파일과 방지

| 파일                                                               | 위험              | 방지                                                                |
| ------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------- |
| `src/shared/ui/**`, `src/shared/styles/**`, `src/shared/assets/**` | 공용 UI·시각 체계 | 담당자 1만 수정                                                     |
| 기능별 `screens/*.css`                                             | 페이지 UI 변경    | 해당 기능 담당자만 수정하고 공용 토큰·UI 사용, 담당자 1이 최종 검수 |
| `src/app/state.js`                                                 | 모든 선택값 저장  | 담당자 1만 수정, schema 변경 요청 사용                              |
| `src/app/main.js`                                                  | 모든 route 등록   | 담당자 1만 수정                                                     |
| `package.json`/lockfile                                            | 테스트 도구 추가  | 담당자 1만 수정                                                     |
| public `index.js`                                                  | 영역 간 계약      | 소유자만 수정, interface-change 표시                                |
| MatchSetup/MatchResult                                             | 담당자 2~4 연결   | Contracts v1과 MatchSetup version 1 고정                            |

담당자 2~4는 자기 기능의 페이지 전용 CSS만 수정한다. shared의 색상, 폰트, 간격, 그림자, 반응형 토큰과 공용 버튼·입력창·카드·모달을 사용하며 이를 페이지 CSS에서 다시 정의하지 않는다. 공용화가 필요한 UI는 담당자 1에게 변경 요청으로 제출한다.

작업 전후:

```bash
git status --short
git diff --name-only
git diff --check
npm run build
```

현재 `package.json`에는 `dev`, `build`, `preview`, `audit`만 있고 `test`와 `lint` 스크립트는 없다. 따라서 현 시점의 공통 필수 검증은 `npm run build`와 수동 흐름 확인이다. 테스트 도구나 스크립트를 추가해야 하면 `package.json` 소유자인 담당자 1이 별도 통합 PR에서 처리한다.

## 12. 담당자별 Codex 작업 프롬프트

### 담당자 1 프롬프트

```text
당신은 REWIND FC의 앱 플랫폼·전체 UI·통합 담당자다.

담당 기능:
- 전체 디자인 시스템
- 시작 화면과 감독명
- router/history
- app state와 localStorage
- 공용 UI와 공용 스타일
- 디자인 토큰, 색상, 폰트, 간격, 그림자, 반응형 기준
- 공용 버튼, 입력창, 카드, 모달
- 모든 기능 PR의 최종 UI 검수
- 화면 등록과 최종 통합

수정 허용:
- src/app/**
- src/shared/**, 특히 src/shared/ui/**, src/shared/styles/**, src/shared/assets/**
- src/main.js
- index.html
- package.json, package-lock.json
- vite.config.js
- README 및 배포/CI 설정

수정 금지:
- src/roster/**
- src/tournament/**
- src/lineup/**
- src/tactics/**
- src/simulation/**
- src/match/**

사용할 공개 API:
- roster/index.js
- tournament/index.js
- lineup/index.js
- tactics/index.js
- match/index.js

외부에 제공:
- app/public.js의 상태 API
- shared/index.js의 공용 UI
- router가 화면 context로 주입하는 ctx.navigate(routeName, params?, options?)

입력/출력:
- 입력: 각 기능의 공개 route와 기본 상태
- 출력: 검증된 AppState, route context, 공용 UI 계약

구현 목록:
- 디자인 토큰과 공용 컴포넌트
- `manager`와 전체 route 등록
- route 진입 guard와 조건 미충족 시 이전 route로 replace 이동
- history, 뒤로가기/앞으로가기와 match 이탈 cleanup
- localStorage schema validation/migration
- 전체 UI 일관성 검수
- 담당자 2~4의 페이지 전용 CSS가 토큰과 공용 UI를 준수하는지 검수
- CI 경로 검사

예외:
- 손상된 저장 데이터
- 알 수 없는 route
- 경기 중 뒤로가기
- 기능 API가 아직 준비되지 않은 상태

완료 조건:
- 전체 흐름이 연결됨
- 기능 로직을 직접 수정하지 않음
- build 성공
- 모바일/데스크톱 UI 확인

테스트:
- 현재 필수: router/history, route guard, 뒤로가기/앞으로가기 수동 검증
- 현재 필수: localStorage 정상/오류와 전체 흐름 smoke test
- 테스트 환경 도입 후: router, route guard, AppState migration 단위 테스트

담당 밖 문제:
- 직접 수정하지 말고 파일, 증상, 필요한 공개 API 변경안을 보고한다.
- 공용 인터페이스 변경이 필요해도 직접 구현하지 말고 변경 제안으로 남긴다.
- 다른 담당자의 기존 변경을 되돌리지 않는다.

변경 파일 확인:
- 시작 전 git status --short, git diff --name-only
- 종료 후 같은 명령과 git diff --check, npm run build
- 금지 경로 변경이 있으면 완료 처리하지 않는다.
- 마지막 보고에 변경 파일 목록과 테스트 결과를 포함한다.
```

### 담당자 2 프롬프트

```text
당신은 REWIND FC의 선수 선발·선수 데이터·대진표 담당자다.

담당 기능:
- 선수 목록/검색/필터/정렬
- 선수 선택과 명단 검증
- 대진표, 라운드, 다음 상대
- MatchResult에 따른 대진 갱신
- `roster`, `tournament` 화면 제공

수정 허용:
- src/roster/**
- src/tournament/**
- src/roster/screens/roster.css
- src/tournament/screens/tournament.css

수정 금지:
- 위 허용 목록 밖의 저장소 전체
- src/shared/ui/**, src/shared/styles/**, src/shared/assets/**
- 페이지 CSS에서 색상, 폰트, 버튼, 카드 등 공용 체계를 재정의하는 작업

UI 규칙:
- 페이지 전용 CSS는 담당자 1의 디자인 토큰과 공용 UI를 사용한다.
- 새 공용 UI나 토큰이 필요하면 담당자 1에게 요청하고 직접 shared를 수정하지 않는다.

사용할 공개 API:
- app/public.js의 상태 port
- shared/index.js의 공용 UI
- shared contracts의 Player, MatchResult

외부에 제공:
- PLAYERS/findById/byPos/overall/defaultPool
- validateSelectedSquad
- toSimulationPlayer
- createInitialBracket(config?)
- getCurrentRound(bracket)
- getNextOpponent(bracket, teamId)
- recordMatchResult(bracket, matchResult) -> TournamentBracket
- validateBracket(bracket)

입력/출력:
- 입력: Player[], 선택 명령, MatchResult
- 출력: SelectedSquad, TournamentBracket, Opponent

구현 목록:
- roster 데이터/도메인/화면
- 포지션과 GK 검증
- tournament 데이터/진행/화면
- 팀이 승인한 대회 규모와 라운드 정책에 따라 구현
- 16강 단일 토너먼트는 추천 기본안이며 승인 전에는 특정 규모에 종속된 대진 생성·화면 구현을 시작하지 않음
- `createInitialBracket(config?)`는 승인된 대회 설정을 입력받아 동작
- 결과 반영과 다음 상대 계산
- tournament 내부 전역 상태를 만들지 않고 AppStateV2의 bracket을 입력으로 사용
- 입력 bracket을 변경하지 않고 새 TournamentBracket을 반환
- 무승부, 승부차기, 완료 경기 재실행과 결과 수정 정책 반영

예외:
- 선수 부족
- GK 없음
- 주장 미포함
- 상대 미결정
- 무승부/잘못된 MatchResult
- penaltyScore 누락 또는 승부차기 동점
- 완료 경기 재실행/결과 수정 시도

완료 조건:
- 잘못된 명단 확정 불가
- 대진 진행 테스트 통과
- public index만 외부에 노출
- 입력 bracket 불변성과 AppStateV2 단일 저장 상태 유지

테스트:
- 선택/해제/제한
- 포지션 검증
- 승자 진출
- 다음 상대
- 정규시간/승부차기 승자 진출과 잘못된 penaltyScore 거부
- bracket 불변성 및 AppStateV2 저장/복원

담당 밖 문제:
- 직접 수정하지 말고 대상 담당자에게 재현 절차와 변경 제안을 보고한다.
- 공용 인터페이스 변경이 필요해도 직접 구현하지 말고 변경 제안으로 남긴다.
- 다른 담당자의 기존 변경을 되돌리지 않는다.

변경 파일 확인:
- 시작/종료 시 git status --short와 git diff --name-only
- git diff --check와 npm run build
- src/roster, src/tournament 밖 변경이 있으면 완료 처리하지 않는다.
- 마지막 보고에 변경 파일 목록과 테스트 결과를 포함한다.
```

### 담당자 3 프롬프트

```text
당신은 REWIND FC의 선발 라인업·포메이션·경기 전 전술 담당자다.

담당 기능:
- 선발 11명과 교체 선수
- 포지션/슬롯 배치
- 포메이션
- 주장/GK 역할
- 전술 값
- MatchSetup 생성
- `lineup`, `tactics` 화면 제공

수정 허용:
- src/lineup/**
- src/tactics/**
- src/lineup/screens/lineup.css
- src/tactics/screens/tactics.css

수정 금지:
- 위 허용 목록 밖의 저장소 전체
- src/shared/ui/**, src/shared/styles/**, src/shared/assets/**
- 페이지 CSS에서 색상, 폰트, 버튼, 카드 등 공용 체계를 재정의하는 작업

UI 규칙:
- 페이지 전용 CSS는 담당자 1의 디자인 토큰과 공용 UI를 사용한다.
- 새 공용 UI나 토큰이 필요하면 담당자 1에게 요청하고 직접 shared를 수정하지 않는다.

사용할 공개 API:
- roster/index.js의 SelectedSquad
- tournament/index.js의 Opponent
- app/public.js 상태 port
- shared/index.js UI

외부에 제공:
- FORMATIONS/getFormation/getNormalizedSlots
- createStartingLineup/autoLineup/swapAssignments
- validateStartingLineup
- createDefaultTactics/validateTactics
- createMatchSetup

입력/출력:
- 입력: SelectedSquad, Opponent
- 출력: StartingLineup, Formation, Tactics, MatchSetup

구현 목록:
- lineup domain과 화면
- formation 데이터
- formation.id와 배열 순서와 무관한 slot.slotId 사용
- 슬롯 배치와 선수 교환
- tactics domain과 화면
- 최종 검증과 MatchSetup 생성

예외:
- 11명 미완성
- 중복 선수
- GK/주장 오류
- 포메이션 슬롯 불일치
- 상대 미결정

완료 조건:
- 유효한 MatchSetup만 생성
- simulation 내부 파일 직접 import 금지
- 모든 assignment에 playerId, slotId, role, 정규화 x/z가 포함됨
- 공용 UI 직접 수정 금지

테스트:
- 미완성/중복/GK/주장
- 포메이션 변경
- 전술 범위
- MatchSetup schema

담당 밖 문제:
- 직접 수정하지 말고 필요한 API와 데이터 필드를 제안한다.
- 공용 인터페이스 변경이 필요해도 직접 구현하지 말고 변경 제안으로 남긴다.
- 다른 담당자의 기존 변경을 되돌리지 않는다.

변경 파일 확인:
- 시작/종료 시 git status --short와 git diff --name-only
- git diff --check와 npm run build
- src/lineup, src/tactics 밖 변경이 있으면 완료 처리하지 않는다.
- 마지막 보고에 변경 파일 목록과 테스트 결과를 포함한다.
```

### 담당자 4 프롬프트

```text
당신은 REWIND FC의 경기·시뮬레이션·3D·되감기 담당자다.

담당 기능:
- MatchSetup 기반 경기 생성
- 선수와 공 이동
- 패스/슛/골/체력
- fixed timestep 경기 루프
- HUD 상태
- Three.js 렌더링과 카메라
- snapshot/restore/rewind
- 경기 종료와 MatchResult
- cleanup
- `match` 화면 제공

수정 허용:
- src/simulation/**
- src/match/**
- src/match/screens/match.css

수정 금지:
- 위 허용 목록 밖의 저장소 전체
- src/shared/ui/**, src/shared/styles/**, src/shared/assets/**
- 페이지 CSS에서 색상, 폰트, 버튼, 카드 등 공용 체계를 재정의하는 작업

UI 규칙:
- match.css는 담당자 1의 디자인 토큰과 공용 UI를 사용한다.
- 새 공용 UI나 토큰이 필요하면 담당자 1에게 요청하고 직접 shared를 수정하지 않는다.

사용할 공개 API:
- shared contracts의 MatchSetup, MatchState, MatchResult
- 호출자가 전달하는 plain JSON MatchSetup

금지된 의존:
- roster, lineup, tactics의 내부 파일
- roster/index.js, lineup/index.js, tactics/index.js
- 포메이션 정의의 자체 복제

외부에 제공:
- startMatch
- pauseMatch/resumeMatch
- rewindMatch
- getMatchState
- getMatchResult
- destroyMatch

입력/출력:
- 입력: MatchSetup
- 출력: MatchState, MatchResult

MVP 구현 목록:
- 기존 시뮬레이션 동작 유지
- MatchSetup 입력 방식으로 전환
- MatchSetup의 정규화 x/z를 simulation 내부에서 월드 좌표로 변환
- 경기 시작, 일시정지, 재개, 종료
- 기본 3D 경기와 기존 카메라 유지
- 횟수와 snapshot 범위가 제한된 되감기
- decision과 penaltyScore를 포함한 MatchResult
- RAF, 이벤트 리스너, WebGL cleanup

후속 작업:
- 고급 선수 AI
- 고급 패스와 슈팅 판단
- 추가 카메라 연출
- 추가 선수 애니메이션
- 상세 경기 통계
- 고급 성능 최적화
- 추가 시각 효과
- MVP 완료 전에는 후속 작업을 시작하지 않는다.

예외:
- 잘못된 MatchSetup
- 되감기 기록 부족
- 경기 중 뒤로가기
- WebGL 생성 실패
- 경기 종료 후 중복 결과 제출
- 경기 종료 후 되감기
- `match` 화면 이탈 시 `destroyMatch()` 호출 및 재진입 중복 방지

완료 조건:
- simulation은 DOM/Three.js import 0개
- simulation과 match는 roster/lineup/tactics import 0개
- renderer는 경기 결과를 결정하지 않음
- 결정론/되감기 테스트 통과
- 정규시간과 승부차기 MatchResult 계약 통과
- 이탈 후 자원 누수 없음

테스트:
- 동일 seed 결과
- snapshot/restore
- 골/종료/MatchResult
- 승부차기 decision/penaltyScore/winner 검증
- 경기 종료 후 되감기 거부
- 반복 진입/이탈
- 카메라/키보드 smoke

담당 밖 문제:
- 직접 수정하지 말고 필요한 공개 계약 변경안을 보고한다.
- 공용 인터페이스 변경이 필요해도 직접 구현하지 말고 변경 제안으로 남긴다.
- 다른 담당자의 기존 변경을 되돌리지 않는다.

변경 파일 확인:
- 시작/종료 시 git status --short와 git diff --name-only
- git diff --check와 npm run build
- src/simulation, src/match 밖 변경이 있으면 완료 처리하지 않는다.
- 마지막 보고에 변경 파일 목록과 테스트 결과를 포함한다.
```

## 13. 최종 권장 사항

1. 실제 파일 이동 전에 Contracts v1, MatchSetup version 1, AppState schemaVersion 2와 공개 API를 먼저 승인한다.
2. 담당자 1이 shared contracts와 route 뼈대를 먼저 만든다. shared/contracts에는 데이터 계약만 두고 기능 로직을 넣지 않는다.
3. 기존 `team` 분리는 별도 구조 PR로 진행하고 기능 변경과 섞지 않는다.
4. 담당자 2~4는 자기 기능의 `screens/*.css`만 수정하고 공용 토큰과 UI를 사용한다. `src/shared/ui/**`, `src/shared/styles/**`, `src/shared/assets/**`는 담당자 1만 수정한다.
5. simulation과 Three.js 분리는 현재처럼 유지하고, simulation은 MatchSetup만 입력으로 받는다.
6. 각 PR에 담당 경로 검사 CI를 적용한다.
7. 최종 통합은 담당자 1이 수행하되 기능 로직은 각 담당자가 수정한다.
8. tournament는 match를 import하지 않고 plain `MatchResult`만 받아 입력 bracket을 변경하지 않은 새 `TournamentBracket`을 반환한다.
9. 대진표 제품 정책의 “팀 결정 필요” 항목을 MVP 구현 전에 승인한다.
