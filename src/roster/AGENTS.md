# Roster 영역 작업 지침

## 1. 담당자와 목적

- 담당자: **2 — 선수 데이터·선수 선택**
- 담당 기능: 선수 JSON, 파생 등번호, 조회·정렬·능력치 계산, 선수 선택 화면과 명단 검증.
- 담당하지 않는 기능: 대진 진행 규칙, 라인업 슬롯, 전술, 시뮬레이션, 공용 UI와 앱 상태 구현.

## 2. 수정 허용 범위

- 기본 허용: `src/roster/**` 및 그 아래 새 파일.
- 함께 소유: `src/tournament/**`. roster 작업 중에는 필요 없이 함께 수정하지 않는다.
- 페이지 CSS: `src/roster/screens/roster.css`와 roster 화면 아래 새 전용 CSS만 허용한다.
- 공용 토큰과 UI를 사용하며 색상·폰트·버튼·카드를 재정의하지 않는다.

## 3. 공개 API와 계약

- 외부는 `src/roster/index.js`만 사용한다.
- 현재 export: `rosterScreen`, `META`, `PLAYERS`, `byPos`, `findById`, `overall`, `defaultPool`, `autoLineup`, `toSimMeta`.
- 목표 추가 API인 `validateSelectedSquad`, `toSimulationPlayer`는 아직 구현되지 않았다. 필요하면 공개 API 변경 제안 후 roster 소유자가 추가한다.
- RawPlayer 필드와 파생 `num`, SimulationPlayer 형식은 Contracts v1을 따른다.
- app 상태는 `src/app/public.js`, 공용 UI는 `src/shared/index.js`만 사용한다.

## 4. 절대 금지

- 허용 경로 밖 수정·생성, 다른 담당 파일 삭제·이동·이름 변경, 기존 변경 되돌리기·덮어쓰기를 금지한다.
- 다른 담당자의 폴더에 파일을 생성하지 않는다.
- 다른 영역 내부 파일을 직접 import하지 않고 공개 `index.js`만 사용한다.
- 담당자 1 외에는 `src/shared/**`, `src/app/**`, `src/main.js`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`를 수정하지 않는다.
- 외부 라이브러리 설치, 협의 없는 공개 API 변경, Contracts v1·MatchSetup v1·AppState schemaVersion 2 변경을 금지한다.
- 범위 밖 버그 직접 수정, 팀 결정 필요 정책 구현, 범위 밖 UI·게임 규칙·데이터 형식 변경을 금지한다.
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

직접 수정하지 않고 경로·재현·원인·계약 변경안을 기록해 마지막 보고의 **담당자 간 요청 사항**에 넣는다.

## 6. 주요 작업과 완료 조건

- 검색·필터·선택과 인원/GK/포지션 검증을 roster 내부에 둔다.
- 원본 JSON 필드명과 능력치를 임의 변경하지 않는다.
- 완료 조건: 잘못된 명단 확정 차단, 조회 API 안정성, 외부가 public index만 사용, 페이지 CSS가 공용 토큰 준수, `npm run build` 성공.

## 7. 작업 전후 검증

- 전후 `git status --short`, `git diff --name-only`; 종료 시 `git diff --check`, `npm run build`.
- 선수 선택/해제, 인원 제한, GK·포지션, JSON 로드 흐름을 수동 확인한다.
- 마지막에 변경 파일, 검증 결과, 미검증 항목, 담당자 간 요청 사항을 보고한다.
