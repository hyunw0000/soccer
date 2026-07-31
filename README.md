# REWIND FC — 3D 축구 감독 시뮬레이터

전술을 짜고, 3D로 경기를 지켜보고, **되감아서 다시 지시하는** 웹 서비스입니다.
"내가 감독이라면 저기서 저 선수를 안 뺐지" — 그 순간으로 실제로 되돌아갈 수 있게 만드는 것이 이 프로젝트의 출발점입니다.

- 설치·회원가입·결제 없이 브라우저에서 바로 실행됩니다.
- 서버가 없습니다. 시뮬레이션·되감기 전부 브라우저에서 계산합니다.
- 외부 API 키가 필요 없습니다. (심사자가 키 없이 전 기능 확인 가능)

## 실행 방법

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # dist/ 생성
npm run preview  # 빌드 결과 확인
```

요구 환경: Node.js 20 이상 (개발용). 실행되는 서비스 자체는 최신 Chrome/Edge/Safari/Firefox에서 동작합니다.

## 사용 흐름

1. **감독 이름 입력** — 이 이름으로 벤치에 선다.
2. **소집 명단 + 주장 선택** — 55명 풀에서 최대 23명, 주장 1명(★).
3. **전술 구성** — 상대 스카우팅 리포트를 보고 포메이션(4-3-3 / 4-4-2 / 3-4-3), 수비 라인·압박·템포·폭, 선발 11인을 정한다.
4. **경기** — 3D 관절 피규어가 실제로 뛰고, 체력 바가 닳는다.
   - 카메라 3종(방송캠/탑뷰/공 추적), `Space` 일시정지
   - **`R` = 8초 되감기 (경기당 3회 한정)** — 되감으면 자동 정지되고, 그 시점부터 새 전술로 경기가 다시 흘러간다.
   - 경기 중 실시간 전술 슬라이더 조작 가능

## 폴더 구조

```
index.html               앱 진입 HTML
vite.config.js
src/
  main.js                진입점 — 라우터 기동
  router.js              화면 전환기 (이전 화면 정리 강제)
  state.js               감독 세션(이름/명단/전술) + localStorage 검증 로드
  screens/               화면 단위. mount(root, ctx) → cleanup 반환
    managerName.js  squad.js  tactics.js  match.js
  engine/                ★ 순수 로직. three.js를 import 하지 않는다
    params.js            상수/전술 계수
    math.js  rng.js      벡터 헬퍼 / 시드 난수(상태 노출 → 되감기 가능)
    formations.js        포메이션 정의·슬롯 좌표
    entities.js          Player / Ball
    steering.js          arrive · pursuit · separation
    sim.js               경기 시뮬레이션 + snapshot()/restore()
    rewind.js            되감기 링버퍼
  render3d/              ★ three.js 전용. 게임 규칙을 모른다
    scene.js  pitch.js  playerRig.js  cameraRig.js
    matchView.js         engine ↔ three 를 잇는 유일한 어댑터
  ui/dom.js              innerHTML 없이 DOM을 만드는 헬퍼
  styles/base.css
  data/players_korea.json  선수 데이터(더미 스탯)
public/
  legacy/prototype-3d.html  초기 단일 HTML 프로토타입 (그대로 보존, /legacy/prototype-3d.html 로 접속)
  _headers                  Netlify/Cloudflare 보안 헤더
```

### 왜 engine과 render3d를 갈랐나

되감기 때문입니다. 시뮬레이션 상태가 전부 평범한 숫자여야 `snapshot()` 한 번으로 과거를 저장하고 그대로 복원할 수 있습니다. three.js 객체를 상태에 섞으면 이게 불가능해집니다.
`render3d/`는 매 프레임 `engine`의 숫자를 읽어 메시 위치에 반영만 합니다.

되감기 정확도는 테스트로 확인했습니다: 같은 시드 → 같은 경기(결정론), 8초 되감은 뒤 그대로 재생하면 원래 미래와 **완전히 일치**합니다.

## 사용 기술

- **three.js 0.160** (WebGL 3D 렌더링, npm 설치 — CDN 의존 없음)
- **Vite 8** (번들·개발 서버)
- 프레임워크 없는 순수 JavaScript (ES Modules)

## 배포

정적 사이트이므로 어디든 올릴 수 있습니다.

| 호스팅 | 설정 |
| --- | --- |
| Vercel | 저장소 연결만 하면 `vercel.json` 대로 빌드·헤더 적용 |
| Netlify / Cloudflare Pages | Build `npm run build`, Publish `dist` (`public/_headers` 자동 적용) |
| GitHub Pages | `dist/`를 배포. 단, 보안 헤더 설정은 지원되지 않음 |

`vite.config.js`의 `base: './'` 덕분에 서브경로 배포에서도 경로가 깨지지 않습니다.

## 데이터 및 저작권

- `src/data/players_korea.json`의 선수 이름·포지션·소속팀은 공개된 정보를 참고해 **직접 구성한 JSON**이며, 능력치(`stats`)는 전부 밸런싱용 **더미값**입니다. 실제 선수의 능력을 평가하거나 대변하지 않습니다.
- 외부 이미지·폰트·아이콘 에셋을 사용하지 않습니다. 잔디·등번호 텍스처는 런타임에 Canvas로 그립니다.
- 사용 라이브러리 라이선스: three.js(MIT), Vite(MIT).
- 이 저장소의 코드는 MIT 라이선스입니다. `LICENSE` 참고.

## 보안

공개 저장소·공개 배포를 전제로 점검한 내용은 [`SECURITY.md`](./SECURITY.md)에 정리했습니다. 요약하면 **비밀값이 존재하지 않는 구조**이고, 사용자 입력은 `textContent`로만 렌더링합니다.
