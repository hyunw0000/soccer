# 국기 무결성 절대 규칙

1. 국기는 중앙 국가 데이터와 공통 `CountryFlag` 컴포넌트로만 표시한다.
2. 화면에서 국기 파일 경로를 조합하거나 하드코딩하지 않는다.
3. FIFA 3자리 코드를 국기 파일 코드로 사용하지 않는다.
4. FIFA 코드에서 ISO 코드를 추측하거나 문자열 변환으로 생성하지 않는다.
5. `countries`의 명시적인 `iso2` 매핑만 사용한다.
6. 기존 국기 SVG를 생성·재작성·포맷 변경·삭제하지 않는다.
7. 대진표와 UI 작업은 국기 에셋 및 manifest를 변경하지 않는 것을 기본으로 한다.
8. 새 국가를 추가할 때만 국가 데이터와 manifest를 함께 추가한다.
9. 국기 변경 전후 `npm run validate:flags`를 실행한다.
10. 개발 서버와 프로덕션 빌드에서 등록 국가의 국기 로딩을 확인한다.
11. 로드 실패를 CSS·이모지·생성형 이미지로 대체하지 않는다.
12. 코드 fallback은 런타임 안전장치이며 정상 국가의 기본 표시가 아니다.
13. UI 리팩터링 중 `CountryFlag`를 임시 `img` 구현으로 교체하지 않는다.
14. 국기 경로나 manifest 변경은 이유와 검증 결과를 반드시 보고한다.
15. `CountryFlag`에는 FIFA `teamId`만 전달하며 ISO 코드·국가명·에셋 URL을 전달하지 않는다.
16. 조별리그·토너먼트 UI 수정 후에는 두 하위 탭과 시간선 전환 상태의 국기를 확인한다.

## 강제 장치

- UI는 `teamId`만 `CountryFlag`에 전달한다.
- `getCountryByTeamId`와 `getFlagAssetByTeamId`가 유일한 resolver다.
- `npm test`와 `npm run build`는 등록 국가, ISO 중복, manifest 및 SVG 존재 여부를 검사한다.
- 검증 스크립트는 등록된 34개 필수 매핑, 단일 `CountryFlag` 정의, resolver 우회와 UI의 직접 SVG 경로 사용도 검사한다.
- 국기 출처는 `flag-icons` 7.5.0, MIT 라이선스다.
