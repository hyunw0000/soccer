/**
 * 상대 팀 데이터 (담당자 2).
 *
 * 2026 북중미 월드컵에서 우리가 만나는 여섯 팀을 대회 진행 순서대로 둔다.
 * 각 팀의 원본은 `players_<team>.json` 하나이며 roster의 players_korea.json과 같은 스키마다
 * (meta + players, overall은 세부 스탯의 포지션 가중 평균에서 파생).
 *
 * 팀별 포메이션과 선발 11인은 meta.formationId / meta.startingXI에 들어 있다.
 * startingXI는 그 포메이션 슬롯 배열과 같은 순서(GK → DF → MF → FW)로 적는다 —
 * 슬롯에 누구를 세울지는 데이터가 정하고, 좌표는 lineup의 포메이션 정의가 정한다.
 */

import argentina from './players_argentina.json';
import canada from './players_canada.json';
import france from './players_france.json';
import morocco from './players_morocco.json';
import southAfrica from './players_southafrica.json';
import spain from './players_spain.json';

/** 대회에서 만나는 순서. 조별리그 → 결승. */
const RAW_TEAMS = [southAfrica, canada, morocco, france, spain, argentina];

/** JSON 한 팀을 화면과 계약이 함께 쓰는 하나의 모양으로 정리한다. */
function toTeam(raw) {
  const { meta, players } = raw;
  const byId = new Map(players.map((p) => [p.id, p]));
  // 명단에 없는 id가 startingXI에 적혀 있으면 조용히 빈 자리로 두지 않고 걸러 낸다.
  const startingXI = meta.startingXI.filter((id) => byId.has(id));

  return Object.freeze({
    id: meta.teamCode,
    name: meta.team,
    // 대진표처럼 좁은 자리에 넣을 짧은 이름. 없으면 정식 이름을 그대로 쓴다.
    shortName: meta.teamShort ?? meta.team,
    nameEn: meta.teamEn,
    code: meta.teamCode,
    stage: meta.stage,
    stageLabel: meta.stageLabel,
    stageOrder: meta.stageOrder,
    coach: meta.coach,
    formationId: meta.formationId,
    style: meta.style,
    strength: meta.strength,
    captainId: meta.captainId,
    startingXI: Object.freeze(startingXI),
    players: Object.freeze(players.map((p) => Object.freeze({ ...p, stats: Object.freeze(p.stats) }))),
    findById: (id) => byId.get(id) ?? null,
  });
}

export const OPPONENT_TEAMS = Object.freeze(
  RAW_TEAMS.map(toTeam).sort((a, b) => a.stageOrder - b.stageOrder)
);

/** 스테이지 id(group, r32, r16, qf, sf, final)로 상대를 찾는다. 없으면 null. */
export function findTeam(stageOrCode) {
  if (!stageOrCode) return null;
  return (
    OPPONENT_TEAMS.find((t) => t.stage === stageOrCode || t.code === stageOrCode || t.id === stageOrCode) ??
    null
  );
}

/** 대진표가 없을 때의 기본 상대 = 첫 경기 상대. */
export const FIRST_OPPONENT = OPPONENT_TEAMS[0];
