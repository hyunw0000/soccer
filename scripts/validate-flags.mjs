import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname,'..');
const countriesSource = readFileSync(resolve(root,'src/shared/data/countries.js'),'utf8');
const manifestSource = readFileSync(resolve(root,'src/shared/data/flagAssets.js'),'utf8');
const resolverSource = readFileSync(resolve(root,'src/shared/data/countryFlags.js'),'utf8');
const componentSource = readFileSync(resolve(root,'src/shared/ui/CountryFlag.js'),'utf8');
const countries = [...countriesSource.matchAll(/^\s{2}([A-Z]{3}):.*fifaCode: '([^']+)'.*iso2: '([^']+)'/gm)].map(([,teamId,fifaCode,iso2])=>({teamId,fifaCode,iso2}));
const manifestKeys = new Set([
  ...[...manifestSource.matchAll(/^import\s+(\w+)\s+from\s+'flag-icons\/flags\/4x3\/([^']+)\.svg\?url';/gm)].map(([,binding,iso2])=>iso2),
]);
const errors=[];
const seen=new Map();
for(const {teamId,fifaCode,iso2} of countries){
  if(teamId!==fifaCode) errors.push(`${teamId}: fifaCode가 키와 다릅니다 (${fifaCode})`);
  if(!iso2) errors.push(`${fifaCode}: iso2 누락`);
  if(seen.has(iso2)) errors.push(`${fifaCode}: ${iso2}가 ${seen.get(iso2)}와 중복`);
  seen.set(iso2,fifaCode);
  if(!manifestKeys.has(iso2)) errors.push(`${fifaCode}: flagAssets에 ${iso2} 누락`);
  const assetPath=resolve(root,'node_modules/flag-icons/flags/4x3',`${iso2}.svg`);
  if(!existsSync(assetPath)) errors.push(`${fifaCode}: SVG 파일 없음 (${iso2}.svg)`);
}
const requiredMappings = { MEX:'mx',KOR:'kr',CZE:'cz',RSA:'za',CAN:'ca',GER:'de',PAR:'py',NED:'nl',MAR:'ma',BRA:'br',JPN:'jp',FRA:'fr',SWE:'se',CIV:'ci',NOR:'no',ECU:'ec',ENG:'gb-eng',COD:'cd',USA:'us',BIH:'ba',BEL:'be',SEN:'sn',POR:'pt',CRO:'hr',ESP:'es',AUT:'at',SUI:'ch',ALG:'dz',ARG:'ar',CPV:'cv',COL:'co',GHA:'gh',AUS:'au',EGY:'eg' };
for (const [fifaCode,iso2] of Object.entries(requiredMappings)) {
  const country = countries.find((item) => item.fifaCode === fifaCode);
  if (country?.iso2 !== iso2) errors.push(`${fifaCode}: 필수 매핑은 ${iso2}여야 합니다.`);
}
if(manifestKeys.size!==countries.length) errors.push(`manifest ${manifestKeys.size}개와 국가 ${countries.length}개 수가 다릅니다.`);
if(!resolverSource.includes('flagAssets[country.iso2]')) errors.push('resolver가 중앙 iso2 → manifest 경로를 사용하지 않습니다.');
if(componentSource.includes('flagAssets[') || !componentSource.includes('getFlagAssetByTeamId(teamId)')) errors.push('CountryFlag가 단일 resolver를 우회합니다.');

const sourceFiles = readdirSync(resolve(root,'src'),{recursive:true})
  .filter((name)=>name.endsWith('.js'))
  .map((name)=>resolve(root,'src',name));
const countryFlagDefinitions=[];
for(const file of sourceFiles){
  const source=readFileSync(file,'utf8');
  if(/(?:function|const)\s+CountryFlag\b/.test(source)) countryFlagDefinitions.push(file);
  if(!file.endsWith('flagAssets.js') && /(?:flag-icons\/flags|flags\/[^'"`]+\.svg|\.svg\?url)/.test(source)) errors.push(`직접 국기/SVG 경로 사용 금지: ${file}`);
  if(!file.endsWith('CountryFlag.js') && /CountryFlag\s*\(\s*\{[^}]*\b(?:iso2|countryName|fifaCode)\b/s.test(source)) errors.push(`CountryFlag에는 teamId만 전달해야 합니다: ${file}`);
}
if(countryFlagDefinitions.length!==1) errors.push(`CountryFlag 정의는 하나여야 합니다: ${countryFlagDefinitions.join(', ')}`);
if(errors.length){ console.error(errors.join('\n')); process.exitCode=1; }
else console.log(`국가 ${countries.length}개 · 고유 국기 ${seen.size}개 검증 통과`);
