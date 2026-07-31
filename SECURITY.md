# 보안 점검 기록

공개 GitHub 저장소 + 공개 배포 URL을 전제로 점검했습니다.
핵심 전제는 **이 서비스에는 지켜야 할 비밀값이 아예 없다**는 것입니다. 서버·DB·로그인·결제·외부 API 키가 없으므로 유출될 자격증명 자체가 존재하지 않습니다.

## 점검 결과

| 항목 | 결과 |
| --- | --- |
| 커밋 대상에 `node_modules/`, `dist/`, `.env` 포함 여부 | 없음 |
| 작업 트리 시크릿 패턴(api key, token, private key, AWS/GCP/GitHub 키 형식) | 없음 |
| 전체 커밋 히스토리 시크릿 스캔 | 없음 |
| 이메일·개인 식별정보 하드코딩 | 없음 |
| 앱 코드의 외부 네트워크 호출 | 없음 (`connect-src 'self'`로 차단) |
| `innerHTML` / `eval` / `new Function` / `document.write` 사용 | 없음 |
| `npm audit` (전체 의존성) | 취약점 0건 |

## 설계상 지킨 규칙

**1. 비밀값을 만들지 않는다**
환경변수가 필요 없는 구조입니다. `.env.example`은 견본일 뿐 실제 값은 들어있지 않습니다.
Vite는 `VITE_` 접두사 변수를 번들에 그대로 박아 브라우저에 노출하므로, **비밀값에는 절대 `VITE_`를 붙이지 않습니다.** 나중에 AI 전술 추천처럼 키가 필요한 기능을 붙인다면 반드시 서버리스 함수(`api/*.js`)에서 접두사 없는 이름으로 읽어 프록시해야 합니다.

**2. 사용자 입력은 텍스트로만 렌더링한다**
감독 이름은 사용자가 직접 입력해 화면에 다시 표시되는 유일한 문자열입니다.
`src/shared/ui/dom.js`는 `textContent`만 사용하고 `innerHTML`을 제공하지 않습니다. 길이도 20자로 제한합니다. XSS 경로가 코드에 존재하지 않습니다.

**3. localStorage 값을 신뢰하지 않는다**
저장 데이터는 사용자가 직접 조작할 수 있는 입력입니다. `src/app/state.js`의 `load()`는 저장값의 타입·범위·존재하는 선수 id인지를 전부 검증하고, 통과한 값만 받아들입니다. 파싱 실패 시 기본값으로 되돌아갑니다.
저장하는 값은 감독 닉네임과 선택한 선수 id·전술 수치뿐이며, 개인정보나 인증정보는 저장하지 않습니다.

**4. 응답 헤더로 한 겹 더 막는다**
`vercel.json`(Vercel), `public/_headers`(Netlify/Cloudflare)에 CSP·`nosniff`·`Referrer-Policy: no-referrer`·`X-Frame-Options: DENY`·`Permissions-Policy`를 설정했습니다.
CSP는 `default-src 'self'`라 외부 스크립트 주입·데이터 유출 통로를 차단합니다. (`style-src`에 `'unsafe-inline'`만 예외 — 전술 보드의 좌표를 인라인 스타일로 배치하기 때문입니다.)

**5. 공급망 의존을 최소화한다**
런타임 의존성은 three.js 하나뿐이고 npm으로 고정 설치합니다. CDN에서 스크립트를 받아오지 않으므로 CDN 장애·변조에 영향받지 않습니다.
`package-lock.json`을 커밋해 심사 시점에도 동일한 버전이 설치됩니다.

## 알려진 예외 1건

`public/legacy/prototype-3d.html` (초기 단일 HTML 프로토타입)은 기록 보존을 위해 **원본 그대로** 두었기 때문에 three.js를 `unpkg.com`에서 가져옵니다.
- 이 페이지에만 CSP 예외(`script-src 'self' https://unpkg.com`)를 두었습니다.
- 버전이 `three@0.160.0`으로 고정돼 있습니다.
- 본 서비스(`/`)는 이 경로에 전혀 의존하지 않습니다. unpkg가 죽어도 서비스는 정상 동작합니다.

## 푸시 전 확인 명령

```bash
git status --short                      # 의도한 파일만 올라가는지
git ls-files | grep -E "node_modules|dist/|\.env$"   # 결과가 비어야 정상
npm audit                               # 0 vulnerabilities
```
