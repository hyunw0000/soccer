/** 3D 유니폼과 경기 안내가 함께 사용하는 단일 색상 설정. */
export const MATCH_SIDE_STYLES = Object.freeze({
  home: Object.freeze({ simulationColor:'red', uniformLabel:'빨간색', uniformColor:'#c8102e', uniformHex:0xc8102e, teamLabel:'RED TEAM' }),
  away: Object.freeze({ simulationColor:'blue', uniformLabel:'파란색', uniformColor:'#1f6feb', uniformHex:0x1f6feb, teamLabel:'BLUE TEAM' }),
});

export function getMatchSides(matchSetup) {
  return Object.freeze({
    home: Object.freeze({ ...MATCH_SIDE_STYLES.home, teamId:matchSetup.homeTeam.id, code:matchSetup.homeTeam.code ?? matchSetup.homeTeam.id }),
    away: Object.freeze({ ...MATCH_SIDE_STYLES.away, teamId:matchSetup.awayTeam.id, code:matchSetup.awayTeam.code ?? matchSetup.awayTeam.id }),
  });
}
