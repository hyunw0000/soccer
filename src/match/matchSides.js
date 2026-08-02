/**
 * 3D 유니폼과 경기 안내가 함께 사용하는 단일 색상 설정.
 *
 * 골키퍼는 필드 플레이어와 다른 색을 입는다(gkUniform*). 실제 축구 규칙과 같은 이유다 —
 * 골키퍼는 양 팀 필드 플레이어 **그리고 상대 골키퍼와도** 구별되어야 한다. 그래서 양 팀
 * 골키퍼에게 같은 색을 주지 않고 노란색/핑크색으로 갈라 놓았다.
 * 필드 플레이어 색(빨강·파랑)은 예전 그대로라 기존 화면은 달라지지 않는다.
 */
export const MATCH_SIDE_STYLES = Object.freeze({
  home: Object.freeze({
    simulationColor:'red', uniformLabel:'빨간색', uniformColor:'#c8102e', uniformHex:0xc8102e, teamLabel:'RED TEAM',
    gkUniformLabel:'노란색', gkUniformColor:'#ffd60a', gkUniformHex:0xffd60a,
  }),
  away: Object.freeze({
    simulationColor:'blue', uniformLabel:'파란색', uniformColor:'#1f6feb', uniformHex:0x1f6feb, teamLabel:'BLUE TEAM',
    // 진한 마젠타 계열(#e01f7c 등)은 배지 대비는 나오지만 홈 빨강(#c8102e)과 휘도가 1.1~1.3:1밖에
    // 안 벌어져서 멀리서 홈 팀처럼 보인다. 밝은 핑크는 빨강과 3.1:1로 갈리고 배지도 9.5:1이다.
    gkUniformLabel:'핑크색', gkUniformColor:'#ff9ecb', gkUniformHex:0xff9ecb,
  }),
});

export function getMatchSides(matchSetup) {
  return Object.freeze({
    home: Object.freeze({ ...MATCH_SIDE_STYLES.home, teamId:matchSetup.homeTeam.id, code:matchSetup.homeTeam.code ?? matchSetup.homeTeam.id }),
    away: Object.freeze({ ...MATCH_SIDE_STYLES.away, teamId:matchSetup.awayTeam.id, code:matchSetup.awayTeam.code ?? matchSetup.awayTeam.id }),
  });
}
