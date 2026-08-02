import { countries } from './countries.js';
import { flagAssets } from './flagAssets.js';

/** UI가 사용하는 유일한 팀 → 국가 조회 경계. */
export function getCountryByTeamId(teamId) {
  return countries[teamId] ?? null;
}

/** FIFA 코드를 파일명으로 추측하지 않고 중앙 iso2 매핑만 사용한다. */
export function getFlagAssetByTeamId(teamId) {
  const country = getCountryByTeamId(teamId);
  return country ? (flagAssets[country.iso2] ?? null) : null;
}
