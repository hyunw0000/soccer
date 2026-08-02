# Lineup 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **3 — 선발 라인업·포메이션**
- 담당 기능: 포메이션 정의, 안정적인 슬롯, 선발·교체 배치와 역할 검증, 정규화 좌표 생성.
- 담당하지 않는 기능: 선수 원본 데이터, 대진 정책, 전술 값 저장, 월드 좌표·경기 물리, Three.js.

## 2. 수정 허용 범위

- 기본 허용: `src/lineup/**` 및 그 아래 새 파일.
- 함께 소유: `src/tactics/**`. lineup 작업 중에는 필요 없이 함께 수정하지 않는다.
- 페이지 CSS: `src/lineup/screens/lineup.css`와 lineup 화면 아래 새 전용 CSS만 허용한다.
- 공용 토큰과 UI를 사용하고 공용 시각 체계를 재정의하지 않는다.

## 3. 공개 API와 계약

- 외부는 `src/lineup/index.js`만 사용한다.
- 포메이션: `FORMATIONS`, `FORMATION_KEYS`, `LINEUP_SIZE`, `COORD_MIN`, `COORD_MAX`, `getFormation`, `getNormalizedSlots`, `getSlot`, `positionNeeds`, `resolveFormationId`.
- 라인업 도메인(모두 순수 함수, 입력을 변경하지 않는다): `createStartingLineup`, `autoLineup`, `assignPlayer`, `swapAssignments`, `changeFormation`, `syncSubstitutes`, `setCaptain`, `startingPlayerIds`, `getAssignment`, `isComplete`, `createLookup`.
- 검증: `validateStartingLineup(startingLineup, selectedSquad?, playerCatalog?)` → `{ ok, errors[{code,message}] }`, `formatErrors`.
- 역할(라인): `ROLES`, `ROLE_LABEL`, `ROLE_ZONES`, `isRole`, `roleAtX`, `roleFits`, `roleFitScore`.
- 세부 포지션: `POSITIONS`, `POSITION_CODES`, `DEPTH_BANDS`, `isPosition`, `depthBand`, `positionCode(role, x, z)`, `positionOf({role,x,z})`, `positionName`, `positionPenalty`, `selectionScore`, `roleOfPosition`.
  - `positionPenalty(player, code)`는 자리가 어긋난 정도를 **능력치 점수 단위**로 돌려준다. `selectionScore`는 능력치에서 그 감점을 뺀 값이며, 자동 편성과 목록 정렬이 함께 쓴다.
  - 자동 편성은 슬롯 순서대로 뽑지 않고 `selectionScore` 합이 최대가 되도록 전체를 함께 배정한다.
  - 세부 포지션은 깊이(x)와 좌우(z)를 함께 읽어 파생한다. `positionLabel`은 `positionCode`의 별칭이며 시그니처가 `(role, x, z)`로 바뀌었다.
  - 슬롯의 `label`/`position`도 좌표에서 파생한다. 포메이션 표에 이름을 손으로 적어 두지 않는다.
- 화면: `lineupScreen`(라우트 등록은 담당자 1), `createLineupEditor`(lineup·tactics 화면이 공유하는 배치 편집기).
- 위 목록을 바꾸려면 공개 계약을 먼저 협의한다.
- Formation은 `formation.id`, 슬롯은 배열 순서와 무관한 `slot.slotId`를 사용한다.
- StartingLineup assignment는 `playerId`, `slotId`, `role`, 정규화 `x`, `z`를 포함한다.
- simulation 내부 또는 공개 index도 import하지 않는다. 월드 좌표 변환은 simulation 책임이다.

## 4. 절대 금지

- 허용 경로 밖 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리 설치, 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- 범위 밖 버그 직접 수정, 팀 결정 필요 정책 구현, 범위 밖 UI·게임 규칙·선수 데이터 변경을 금지한다.
- 포메이션 정의를 다른 영역에 복제하거나 빌드 오류를 이유로 다른 폴더를 수정하지 않는다.
- 금지 경로가 바뀌면 완료로 보고하지 않는다.

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

- 정확히 11개 슬롯, 중복 없는 선수, GK·주장·포지션과 좌표 범위를 검증한다.
- 포메이션 변경에도 안정적인 slotId를 유지한다.
- 완료 조건: 포메이션 슬롯 수와 역할 유효, assignment 중복 없음, public index 경계, 페이지 CSS 토큰 준수, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`; 종료 시 `git diff --check`, `npm run build`.
- 포메이션별 11개 슬롯, slotId 유일성, 좌표 범위, 선수 교환과 미완성·중복 라인업을 확인한다.
- 마지막에 변경 파일, 검증 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
