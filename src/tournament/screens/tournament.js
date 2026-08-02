import { CountryFlag, countries, el } from '../../shared/index.js';
import { createInitialBracket, validateBracket } from '../domain/bracket.js';
import { tournamentRounds } from '../data/bracket.js';
import './tournament.css';

const STATUS_LABELS = Object.freeze({
  locked: '진출 결과 대기',
  pending: '진출팀 미정',
  scheduled: '진행 전',
  live: '진행 중',
  completed: '종료',
});

const KOREA_PATH = new Set([73, 90, 97, 101, 104]);

function teamRow(teamId, side, match) {
  if (!teamId) {
    return el('div', { class: 'wc-team wc-team--unknown' }, [
      el('span', { class: 'wc-team__seed', text: side === 'home' ? 'HOME' : 'AWAY' }),
      el('span', { class: 'wc-team__unknown-mark', text: '—', 'aria-hidden': 'true' }),
      el('span', { class: 'wc-team__name', text: '진출팀 미정' }),
    ]);
  }
  const country = countries[teamId];
  const score = match.score?.[side];
  return el('div', { class: `wc-team${teamId === 'KOR' ? ' is-korea' : ''}` }, [
    CountryFlag({ ...country, fifaCode: teamId, size: 'small' }),
    el('span', { class: 'wc-team__name', text: country.nameKo }),
    el('b', { class: 'wc-team__code', text: country.fifaCode }),
    score != null ? el('strong', { class: 'wc-team__score', text: score }) : null,
  ]);
}

function matchCard(match, roundIndex, matchIndex) {
  const changed = match.matchId === 73 && match.historyChanged;
  const classes = [
    'wc-match',
    KOREA_PATH.has(match.matchId) ? 'is-korea-path' : '',
    changed ? 'is-history-changed' : '',
    match.status === 'locked' ? 'is-locked' : '',
  ].filter(Boolean).join(' ');

  const card = el('article', {
    class: classes,
    'aria-label': `Match ${match.matchId}, ${STATUS_LABELS[match.status] ?? match.status}`,
  }, [
    el('header', { class: 'wc-match__header' }, [
      el('span', { text: `MATCH ${match.matchId}` }),
      el('b', { class: `wc-status wc-status--${match.status}`, text: STATUS_LABELS[match.status] ?? match.status }),
    ]),
    changed ? el('p', { class: 'wc-history-tag', text: '역사가 바뀐 경기' }) : null,
    match.matchId === 73 && match.status === 'locked' ? el('p', { class: 'wc-history-tag wc-history-tag--locked', text: 'A조 2위 확정 대기' }) : null,
    el('div', { class: 'wc-match__teams' }, [
      teamRow(match.homeTeamId, 'home', match),
      teamRow(match.awayTeamId, 'away', match),
    ]),
    match.nextMatchId != null
      ? el('footer', { class: 'wc-match__next', text: `승자 → Match ${match.nextMatchId}` })
      : el('footer', { class: 'wc-match__next wc-match__next--final', text: '우승 결정전' }),
  ]);
  const gridRow = (2 ** roundIndex) + (matchIndex * (2 ** (roundIndex + 1)));
  card.style.gridRow = `${gridRow} / span 2`;
  return card;
}

function bracketView(bracket) {
  const validation = validateBracket(bracket);
  if (!validation.valid) {
    return el('section', { class: 'wc-bracket-error', role: 'alert' }, [
      el('strong', { text: '대진표 데이터를 표시할 수 없습니다.' }),
      el('p', { text: validation.errors.join(' ') }),
    ]);
  }
  return el('div', { class: 'wc-bracket', role: 'region', 'aria-label': '2026 월드 챔피언십 토너먼트 대진표', tabindex: '0' }, [
    ...tournamentRounds.map((round, roundIndex) => el('section', { class: `wc-round wc-round--${round.roundId}`, 'aria-labelledby': `round-${round.roundId}` }, [
      el('header', { class: 'wc-round__header' }, [
        el('span', { text: 'KNOCKOUT' }),
        el('h2', { id: `round-${round.roundId}`, text: round.label }),
        el('b', { text: `${round.matchIds.length} MATCHES` }),
      ]),
      el('div', { class: 'wc-round__matches' }, round.matchIds.map((id, matchIndex) => matchCard(bracket.matches.find(({ matchId }) => matchId === id), roundIndex, matchIndex))),
    ])),
  ]);
}

/** 기존 /tournament 탭에 들어가는 대회 화면. */
export default function tournamentScreen(root, _ctx, params = {}) {
  const candidateBracket = params.bracket ?? null;
  const savedBracket = candidateBracket && validateBracket(candidateBracket).valid ? candidateBracket : null;
  const qualificationStatus = savedBracket?.qualificationStatus ?? 'pending';
  const requestedTimeline = new URLSearchParams(window.location.search).get('timeline');
  let viewMode = requestedTimeline === 'current'
    ? 'current'
    : requestedTimeline === 'qualified'
      ? 'qualified-preview'
      : qualificationStatus !== 'pending'
        ? 'current'
        : 'qualified-preview';

  const viewRoot = el('div', { class: 'wc-bracket-shell' });
  const statusBanner = el('p', { class: 'wc-qualified-banner' });
  const currentButton = el('button', {
    type: 'button',
    class: 'wc-timeline-button',
    text: '현재 대진',
    'aria-pressed': String(viewMode === 'current'),
  });
  const previewButton = el('button', {
    type: 'button',
    class: 'wc-timeline-button',
    text: '대한민국 진출 시',
    'aria-pressed': String(viewMode === 'qualified-preview'),
  });

  const renderView = () => {
    const bracket = viewMode === 'qualified-preview'
      ? createInitialBracket({ qualificationStatus: 'qualified' })
      : (savedBracket ?? createInitialBracket({ qualificationStatus: 'pending' }));
    currentButton.setAttribute('aria-pressed', String(viewMode === 'current'));
    previewButton.setAttribute('aria-pressed', String(viewMode === 'qualified-preview'));
    if (viewMode === 'qualified-preview') {
      statusBanner.className = 'wc-qualified-banner';
      statusBanner.textContent = '대한민국이 A조 2위로 진출할 경우의 가상 토너먼트 대진입니다.';
    } else if (qualificationStatus === 'qualified') {
      statusBanner.className = 'wc-qualified-banner';
      statusBanner.textContent = '대한민국, A조 2위로 32강 진출';
    } else if (qualificationStatus === 'eliminated') {
      statusBanner.className = 'wc-pending-banner';
      statusBanner.textContent = '현재 시간선에서는 남아프리카공화국이 A조 2위로 Match 73에 진출합니다.';
    } else {
      statusBanner.className = 'wc-pending-banner';
      statusBanner.textContent = '대한민국의 진출 결과가 확정되기 전 현재 대진입니다. Match 73은 원래 시간선으로 잠겨 있습니다.';
    }
    viewRoot.replaceChildren(bracketView(bracket));
  };
  const selectTimeline = (nextMode) => {
    viewMode = nextMode;
    const url = new URL(window.location.href);
    url.searchParams.set('timeline', nextMode === 'current' ? 'current' : 'qualified');
    window.history.replaceState({ ...window.history.state, route: 'tournament' }, '', `${url.pathname}${url.search}${url.hash}`);
    renderView();
  };
  currentButton.addEventListener('click', () => selectTimeline('current'));
  previewButton.addEventListener('click', () => selectTimeline('qualified-preview'));

  root.append(el('main', { class: 'screen tournament-screen' }, [
    el('header', { class: 'wc-hero' }, [
      el('div', { class: 'wc-hero__copy' }, [
        el('p', { class: 'wc-eyebrow', text: 'WORLD CHAMPIONSHIP · NORTH AMERICA 2026' }),
        el('h1', { text: '운명을 다시 쓰는 토너먼트' }),
        el('p', { text: '32강부터 결승까지, 한 번의 결과가 다음 대진을 바꿉니다.' }),
      ]),
      el('div', { class: 'wc-hero__mark', 'aria-label': '2026 대회 토너먼트' }, [
        el('strong', { text: '26' }),
        el('span', { text: 'KNOCKOUT' }),
      ]),
    ]),
    el('section', { class: 'wc-bracket-section' }, [
      el('div', { class: 'wc-bracket-toolbar' }, [
        el('div', {}, [
          el('p', { class: 'wc-eyebrow', text: 'TOURNAMENT BRACKET' }),
          el('h2', { text: '2026 대회 전체 대진' }),
        ]),
        el('div', { class: 'wc-timeline-switch', role: 'group', 'aria-label': '대진 시간선 보기' }, [currentButton, previewButton]),
      ]),
      statusBanner,
      viewRoot,
      el('p', { class: 'wc-scroll-hint', text: '좌우로 이동해 결승까지의 경로를 확인하세요.' }),
    ]),
  ]));
  renderView();
}
