/**
 * 대회 전역 국가 사전.
 * 팀 식별에는 FIFA 3자리 코드를, 국기 조회에는 flag-icons의 ISO/지역 코드를 쓴다.
 */
export const countries = Object.freeze({
  KOR: Object.freeze({ fifaCode: 'KOR', nameKo: '대한민국', nameEn: 'Korea Republic', iso2: 'kr' }),
  RSA: Object.freeze({ fifaCode: 'RSA', nameKo: '남아프리카공화국', nameEn: 'South Africa', iso2: 'za' }),
  CAN: Object.freeze({ fifaCode: 'CAN', nameKo: '캐나다', nameEn: 'Canada', iso2: 'ca' }),
  GER: Object.freeze({ fifaCode: 'GER', nameKo: '독일', nameEn: 'Germany', iso2: 'de' }),
  PAR: Object.freeze({ fifaCode: 'PAR', nameKo: '파라과이', nameEn: 'Paraguay', iso2: 'py' }),
  NED: Object.freeze({ fifaCode: 'NED', nameKo: '네덜란드', nameEn: 'Netherlands', iso2: 'nl' }),
  MAR: Object.freeze({ fifaCode: 'MAR', nameKo: '모로코', nameEn: 'Morocco', iso2: 'ma' }),
  BRA: Object.freeze({ fifaCode: 'BRA', nameKo: '브라질', nameEn: 'Brazil', iso2: 'br' }),
  JPN: Object.freeze({ fifaCode: 'JPN', nameKo: '일본', nameEn: 'Japan', iso2: 'jp' }),
  FRA: Object.freeze({ fifaCode: 'FRA', nameKo: '프랑스', nameEn: 'France', iso2: 'fr' }),
  SWE: Object.freeze({ fifaCode: 'SWE', nameKo: '스웨덴', nameEn: 'Sweden', iso2: 'se' }),
  CIV: Object.freeze({ fifaCode: 'CIV', nameKo: '코트디부아르', nameEn: 'Côte d’Ivoire', iso2: 'ci' }),
  NOR: Object.freeze({ fifaCode: 'NOR', nameKo: '노르웨이', nameEn: 'Norway', iso2: 'no' }),
  MEX: Object.freeze({ fifaCode: 'MEX', nameKo: '멕시코', nameEn: 'Mexico', iso2: 'mx' }),
  ECU: Object.freeze({ fifaCode: 'ECU', nameKo: '에콰도르', nameEn: 'Ecuador', iso2: 'ec' }),
  ENG: Object.freeze({ fifaCode: 'ENG', nameKo: '잉글랜드', nameEn: 'England', iso2: 'gb-eng' }),
  COD: Object.freeze({ fifaCode: 'COD', nameKo: '콩고민주공화국', nameEn: 'DR Congo', iso2: 'cd' }),
  USA: Object.freeze({ fifaCode: 'USA', nameKo: '미국', nameEn: 'United States', iso2: 'us' }),
  BIH: Object.freeze({ fifaCode: 'BIH', nameKo: '보스니아 헤르체고비나', nameEn: 'Bosnia and Herzegovina', iso2: 'ba' }),
  BEL: Object.freeze({ fifaCode: 'BEL', nameKo: '벨기에', nameEn: 'Belgium', iso2: 'be' }),
  SEN: Object.freeze({ fifaCode: 'SEN', nameKo: '세네갈', nameEn: 'Senegal', iso2: 'sn' }),
  POR: Object.freeze({ fifaCode: 'POR', nameKo: '포르투갈', nameEn: 'Portugal', iso2: 'pt' }),
  CRO: Object.freeze({ fifaCode: 'CRO', nameKo: '크로아티아', nameEn: 'Croatia', iso2: 'hr' }),
  ESP: Object.freeze({ fifaCode: 'ESP', nameKo: '스페인', nameEn: 'Spain', iso2: 'es' }),
  AUT: Object.freeze({ fifaCode: 'AUT', nameKo: '오스트리아', nameEn: 'Austria', iso2: 'at' }),
  SUI: Object.freeze({ fifaCode: 'SUI', nameKo: '스위스', nameEn: 'Switzerland', iso2: 'ch' }),
  ALG: Object.freeze({ fifaCode: 'ALG', nameKo: '알제리', nameEn: 'Algeria', iso2: 'dz' }),
  ARG: Object.freeze({ fifaCode: 'ARG', nameKo: '아르헨티나', nameEn: 'Argentina', iso2: 'ar' }),
  CPV: Object.freeze({ fifaCode: 'CPV', nameKo: '카보베르데', nameEn: 'Cabo Verde', iso2: 'cv' }),
  COL: Object.freeze({ fifaCode: 'COL', nameKo: '콜롬비아', nameEn: 'Colombia', iso2: 'co' }),
  GHA: Object.freeze({ fifaCode: 'GHA', nameKo: '가나', nameEn: 'Ghana', iso2: 'gh' }),
  AUS: Object.freeze({ fifaCode: 'AUS', nameKo: '호주', nameEn: 'Australia', iso2: 'au' }),
  EGY: Object.freeze({ fifaCode: 'EGY', nameKo: '이집트', nameEn: 'Egypt', iso2: 'eg' }),
});

export function countryByFifaCode(fifaCode) {
  return countries[fifaCode] ?? null;
}
