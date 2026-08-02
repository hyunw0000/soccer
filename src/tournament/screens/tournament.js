import { CountryFlag, countries, el } from '../../shared/index.js';
import { createOfficialBracket, validateBracket } from '../domain/bracket.js';
import { tournamentRounds } from '../data/bracket.js';
import { getMatchesForTeam } from '../domain/groupStandings.js';
import { createGameProgress } from '../domain/gameProgress.js';
import './tournament.css';

const STATUS_LABELS = Object.freeze({
  locked: '진출 결과 대기',
  pending: '진출팀 미정',
  scheduled: '진행 전',
  live: '진행 중',
  completed: '종료',
  playable: '플레이 가능',
  waiting: '진출팀 대기',
});

const KOREA_PATH = new Set([73, 90, 97, 101, 104]);
const SUB_VIEWS = Object.freeze(['group','knockout']);
// 좁은 카드에 들어가야 하는 이름만 짧게 쓴다. 나머지는 국가 사전의 정식 이름 그대로다.
const SHORT_NAMES = Object.freeze({ RSA:'남아공' });
const shortName = (teamId) => SHORT_NAMES[teamId] ?? countries[teamId]?.nameKo ?? teamId;

const goalDifference = (value) => value > 0 ? `+${value}` : String(value);

function groupTeam(teamId, size = 'small') {
  const country = countries[teamId];
  return el('span', { class:'wc-group-team' }, [
    CountryFlag({teamId,size}),
    el('span',{class:'wc-group-team__name',text:country.nameKo}),
    el('b',{class:'wc-group-team__code',text:country.fifaCode}),
  ]);
}

/**
 * 히어로 자리의 "지금 이 경기" 카드.
 *
 * 진행 상태 하나만 보고 그린다 — 아직 치르지 않았으면 준비 CTA를, 탈락했으면 결과와
 * 다시 시도 버튼을, 우승했으면 우승 표시를 낸다.
 */
function currentMatchCard(progress,ctx,onRetry) {
  const step = progress.activeStep;
  if (!step) return null;
  const played = progress.played.find((entry) => entry.matchId === step.matchId) ?? null;
  const eliminated = progress.status === 'eliminated';
  const champion = progress.status === 'champion';
  const status = champion ? '우승'
    : eliminated ? (step.stage === 'group' ? '조별리그 탈락' : `${step.roundLabel} 탈락`)
    : played ? '종료' : '경기 전';
  const title = champion ? '역사를 다시 썼습니다'
    : step.stage === 'group' ? '운명을 가를 마지막 경기'
    : `${step.roundLabel} · ${shortName(step.opponentTeamId)}전`;
  const [homeTeamId,awayTeamId] = step.koreaSide === 'home' ? ['KOR',step.opponentTeamId] : [step.opponentTeamId,'KOR'];
  const [homeScore,awayScore] = !played ? [null,null]
    : step.koreaSide === 'home' ? [played.koreaScore,played.opponentScore] : [played.opponentScore,played.koreaScore];
  const rule = champion ? '결승까지 모두 이겼습니다. 대한민국이 2026 월드 챔피언십의 주인공입니다.'
    : eliminated ? `${played?.outcome === 'draw' ? '무승부' : '패배'}로 ${step.roundLabel}에서 탈락했습니다. 다시 시도할 수 있습니다.`
    : step.stage === 'group' ? '승리 또는 무승부 시 A조 2위로 32강에 진출합니다. 패배하면 탈락입니다.'
    : `승리하면 ${step.advanceLabel}, 무승부와 패배는 탈락입니다.`;
  const team = (teamId) => el('div',{class:'wc-compact-team'},[
    CountryFlag({teamId,size:'medium'}),
    el('strong',{text:shortName(teamId)}),
  ]);
  const cardClass = `wc-compact-final${played?' is-completed':''}${eliminated?' is-eliminated':''}${champion?' is-champion':''}`;

  return el('section',{class:cardClass,'aria-label':`${title}, ${countries[homeTeamId].nameKo} 대 ${countries[awayTeamId].nameKo}, ${status}`},[
    el('header',{},[
      el('div',{},[el('p',{class:'wc-eyebrow',text:step.eyebrow}),el('h2',{text:title})]),
      el('b',{class:'wc-compact-final__status',text:status}),
    ]),
    el('div',{class:'wc-compact-final__teams'},[
      team(homeTeamId),
      el('strong',{class:'wc-compact-final__versus',text:played?`${homeScore} : ${awayScore}`:'VS'}),
      team(awayTeamId),
    ]),
    el('p',{class:'wc-compact-final__rule',text:rule}),
    !played ? el('button',{
      type:'button',class:'wc-compact-final__cta',
      text:`${shortName(step.opponentTeamId)}전 준비하기`,
      'aria-label':`${countries[step.opponentTeamId].nameKo}전 선수단 준비 화면으로 이동`,
      onclick:()=>ctx.navigate('roster'),
    }) : null,
    played && !champion ? el('button',{
      type:'button',class:'wc-compact-final__cta wc-compact-final__cta--retry',
      text:`↻ ${step.roundLabel} 다시 시도`,
      'aria-label':`${step.roundLabel}을 다시 치릅니다`,
      onclick:()=>onRetry?.(step.matchId),
    }) : null,
  ]);
}

function matchOutcome(match,teamId) {
  if (match.status !== 'completed') return 'scheduled';
  const ownScore = match.homeTeamId === teamId ? match.homeScore : match.awayScore;
  const opponentScore = match.homeTeamId === teamId ? match.awayScore : match.homeScore;
  return ownScore === opponentScore ? 'draw' : ownScore > opponentScore ? 'win' : 'loss';
}

function historyMatchRow(match,teamId) {
  const completed = match.status === 'completed';
  const outcome = matchOutcome(match,teamId);
  const outcomeLabel = {win:'승',draw:'무',loss:'패',scheduled:'경기 전'}[outcome];
  return el('li',{class:`wc-history-match is-${outcome}`},[
    el('div',{class:'wc-history-match__meta'},[
      el('b',{class:'wc-history-match__id',text:`M${match.matchId}`}),
      el('span',{class:'wc-history-match__outcome',text:outcomeLabel}),
    ]),
    el('span',{class:'wc-history-match__team'},[CountryFlag({teamId:match.homeTeamId,size:'small'}),el('span',{text:countries[match.homeTeamId].nameKo})]),
    completed
      ? el('strong',{class:'wc-history-match__score',text:`${match.homeScore}–${match.awayScore}`})
      : el('strong',{class:'wc-history-match__score is-scheduled',text:'–'}),
    el('span',{class:'wc-history-match__team'},[CountryFlag({teamId:match.awayTeamId,size:'small'}),el('span',{text:countries[match.awayTeamId].nameKo})]),
    !completed ? el('span',{class:'wc-history-match__state',text:'경기 전'}) : null,
  ]);
}

function matchHistoryPanel(teamId,matches,onClose) {
  const country = countries[teamId];
  return el('div',{
    class:'wc-match-history-panel',
  },[
    el('header',{},[
      el('div',{},[CountryFlag({teamId,size:'medium'}),el('h3',{id:'match-history-dialog-title',text:`${country.nameKo} 경기 내역`})]),
      el('button',{type:'button',class:'wc-match-history__close',text:'×','aria-label':`${country.nameKo} 경기 내역 닫기`,onclick:onClose}),
    ]),
    matches.length
      ? el('ul',{class:'wc-match-history__list'},matches.map((match)=>historyMatchRow(match,teamId)))
      : el('p',{class:'wc-match-history__empty',text:'표시할 경기 내역이 없습니다.'}),
  ]);
}

function groupStageView(groupState) {
  let expandedTeamId = null;
  let lastTrigger = null;
  let previousBodyOverflow = '';
  const triggers = new Map();
  const dialog = el('dialog',{
    id:'match-history-dialog',
    class:'wc-match-history-dialog',
    'aria-labelledby':'match-history-dialog-title',
  });
  const closeMatchHistory = () => {
    if (dialog.open) dialog.close();
  };
  const openMatchHistory = (teamId,trigger) => {
    if (expandedTeamId) triggers.get(expandedTeamId)?.setAttribute('aria-expanded','false');
    expandedTeamId = teamId;
    lastTrigger = trigger;
    trigger.setAttribute('aria-expanded','true');
    const matches=getMatchesForTeam(groupState.matches,teamId);
    dialog.replaceChildren(matchHistoryPanel(teamId,matches,closeMatchHistory));
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.querySelector('.wc-match-history__close')?.focus();
  };
  const toggleMatchHistory = (teamId) => {
    const trigger=triggers.get(teamId);
    if (expandedTeamId === teamId && dialog.open) closeMatchHistory();
    else openMatchHistory(teamId,trigger);
  };
  const tableRows = groupState.standings.map((row) => {
      const trigger=el('button',{type:'button',class:'wc-match-history-trigger',text:'경기 내역 보기','aria-haspopup':'dialog','aria-expanded':'false','aria-controls':'match-history-dialog','data-match-history-trigger':row.teamId,onclick:()=>toggleMatchHistory(row.teamId)});
      triggers.set(row.teamId,trigger);
      return el('tr',{class:`${row.teamId==='KOR'?'is-korea ':''}${['KOR','RSA'].includes(row.teamId)?'is-finalist ':''}${row.position===2?'is-qualification-line':''}`},[
        el('td',{class:'wc-standing-position',text:row.position}),
        el('th',{scope:'row'},[groupTeam(row.teamId)]),
        ...[row.played,row.points,row.won,row.drawn,row.lost,row.goalsFor,row.goalsAgainst].map((value)=>el('td',{text:value})),
        el('td',{class:`wc-goal-difference${row.goalDifference>0?' is-positive':''}`,text:goalDifference(row.goalDifference)}),
        el('td',{class:'wc-match-history-cell'},[trigger]),
      ]);
  });
  const standingsTable = el('table',{class:'wc-standings-table'},[
    el('thead',{},[el('tr',{},['순위','국가','경기','승점','승','무','패','득점','실점','득실차','경기 내역'].map((text)=>el('th',{scope:'col',text})))]),
    el('tbody',{},tableRows),
  ]);

  const hasResult = groupState.finalMatch.status === 'completed';

  const node = el('section',{class:'wc-group-stage','aria-labelledby':'group-stage-title'},[
    el('div',{class:'wc-group-heading'},[
      el('div',{},[el('p',{class:'wc-eyebrow',text:'GROUP A · MATCHDAY 3'}),el('h2',{id:'group-stage-title',text:'A조 최종전 현황'})]),
      el('p',{text:'다섯 경기가 종료됐습니다. 남은 한 경기가 A조의 마지막 진출팀을 결정합니다.'}),
    ]),
    el('section',{class:'wc-group-panel'},[
      el('header',{class:'wc-group-panel__header'},[el('div',{},[el('span',{text:'GROUP A'}),el('h3',{text:'A조 순위'})]),el('b',{text:hasResult?'최종 순위':'최종전 이전'})]),
      el('div',{class:'wc-standings-scroll',tabindex:'0','aria-label':'A조 순위표, 좌우로 스크롤 가능'},[standingsTable]),
    ]),dialog,
  ]);

  dialog.addEventListener('click',(event)=>{ if(event.target===dialog) closeMatchHistory(); });
  dialog.addEventListener('close',()=>{
    document.body.style.overflow = previousBodyOverflow;
    if (expandedTeamId) triggers.get(expandedTeamId)?.setAttribute('aria-expanded','false');
    expandedTeamId=null;
    lastTrigger?.focus();
    lastTrigger=null;
  });

  return {node,dispose:()=>{
    if(dialog.open) dialog.close();
    document.body.style.overflow = previousBodyOverflow;
    expandedTeamId=null;
  }};
}

function sourceLabel(source) {
  if (!source) return '진출팀 미정';
  if (source.type === 'WINNER') return `Match ${source.matchId} 승자`;
  if (source.type === 'LOSER') return `Match ${source.matchId} 패자`;
  if (source.type === 'GROUP_POSITION') return source.label ?? `${source.groupId}조 ${source.position}위`;
  return countries[source.teamId]?.nameKo ?? '진출팀 미정';
}

function teamRow(teamId, side, match) {
  if (!teamId) {
    return el('div', { class: 'wc-team wc-team--unknown' }, [
      el('span', { class: 'wc-team__seed', text: side === 'home' ? 'HOME' : 'AWAY' }),
      el('span', { class: 'wc-team__unknown-mark', text: '—', 'aria-hidden': 'true' }),
      el('span', { class: 'wc-team__name', text: sourceLabel(match[`${side}Source`]) }),
    ]);
  }
  const country = countries[teamId];
  const score = match[`${side}Score`];
  const isWinner = match.winnerTeamId === teamId;
  return el('div', { class: `wc-team${teamId === 'KOR' ? ' is-korea' : ''}${isWinner ? ' is-winner' : ''}` }, [
    CountryFlag({ teamId, size: 'small' }),
    el('span', { class: 'wc-team__name', text: country.nameKo }),
    el('b', { class: 'wc-team__code', text: country.fifaCode }),
    score != null ? el('strong', { class: 'wc-team__score', text: score }) : null,
  ]);
}

function matchCard(match, roundIndex, matchIndex) {
  const isPathStart = match.matchId === 73 && match.source === 'GAME_TIMELINE';
  const isProjectedPath = match.source === 'GAME_TIMELINE' && KOREA_PATH.has(match.matchId);
  const statusLabel = isPathStart && match.status === 'waiting' ? '32강 진출 대기' : (STATUS_LABELS[match.status] ?? match.status);
  const classes = [
    'wc-match',
    isProjectedPath ? 'is-korea-path' : '',
    match.pathState === 'preview' ? 'is-path-preview' : '',
    match.pathState === 'confirmed' ? 'is-path-confirmed' : '',
    match.historyChanged ? 'is-history-changed' : '',
    match.status === 'locked' ? 'is-locked' : '',
  ].filter(Boolean).join(' ');

  const card = el('article', {
    class: classes,
    'data-match-id': String(match.matchId),
    'aria-label': `Match ${match.matchId}, ${statusLabel}`,
  }, [
    el('header', { class: 'wc-match__header' }, [
      el('span', { text: `MATCH ${match.matchId}` }),
      el('b', { class: `wc-status wc-status--${match.status}`, text: statusLabel }),
    ]),
    isPathStart ? el('p', { class: 'wc-history-tag', text: '바뀔 역사의 시작점' }) : null,
    match.matchId === 73 && match.status === 'locked' ? el('p', { class: 'wc-history-tag wc-history-tag--locked', text: 'A조 2위 확정 대기' }) : null,
    el('div', { class: 'wc-match__teams' }, [
      teamRow(match.homeTeamId, 'home', match),
      teamRow(match.awayTeamId, 'away', match),
    ]),
    match.resultType === 'PENALTIES' ? el('p', { class: 'wc-match__result-meta', text: `승부차기 ${match.homePenaltyScore}–${match.awayPenaltyScore}` }) : null,
    match.resultType === 'AET' ? el('p', { class: 'wc-match__result-meta', text: '연장 종료' }) : null,
  ]);
  const isAuxiliary = match.matchId === 103;
  const gridRow = isAuxiliary ? 26 : (2 ** roundIndex) + (matchIndex * (2 ** (roundIndex + 1)));
  card.style.gridRow = `${gridRow} / span 2`;
  if (isAuxiliary) card.classList.add('is-auxiliary');
  return card;
}

function connectorLayer(bracket, bracketNode) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('wc-connectors');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  bracketNode.prepend(svg);

  let frame = 0;
  const draw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!bracketNode.isConnected) return;
      const rootRect = bracketNode.getBoundingClientRect();
      const width = bracketNode.scrollWidth;
      const height = bracketNode.scrollHeight;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.replaceChildren();

      const sourcesByTarget = new Map();
      for (const match of bracket.matches) {
        if (match.nextMatchId == null) continue;
        const sources = sourcesByTarget.get(match.nextMatchId) ?? [];
        sources.push(match.matchId);
        sourcesByTarget.set(match.nextMatchId, sources);
      }

      for (const [targetId, sourceIds] of sourcesByTarget) {
        if (sourceIds.length !== 2) continue;
        const sourceCards = sourceIds.map((id) => bracketNode.querySelector(`[data-match-id="${id}"]`));
        const targetCard = bracketNode.querySelector(`[data-match-id="${targetId}"]`);
        if (!targetCard || sourceCards.some((card) => !card)) continue;
        const sourceRects = sourceCards.map((card) => card.getBoundingClientRect());
        const targetRect = targetCard.getBoundingClientRect();
        const sourceX = Math.max(...sourceRects.map((rect) => rect.right - rootRect.left));
        const targetX = targetRect.left - rootRect.left;
        const joinX = sourceX + ((targetX - sourceX) / 2);
        const sourceYs = sourceRects.map((rect) => rect.top - rootRect.top + (rect.height / 2));
        const targetY = targetRect.top - rootRect.top + (targetRect.height / 2);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const [firstY, secondY] = sourceYs;
        path.setAttribute('d', [
          `M ${sourceX} ${firstY} H ${joinX}`,
          `M ${sourceX} ${secondY} H ${joinX}`,
          `M ${joinX} ${Math.min(firstY, secondY)} V ${Math.max(firstY, secondY)}`,
          `M ${joinX} ${targetY} H ${targetX}`,
        ].join(' '));
        path.classList.add('wc-connector');
        if (bracket.timeline === 'game' && KOREA_PATH.has(targetId) && sourceIds.some((id) => KOREA_PATH.has(id))) {
          path.classList.add(bracket.qualificationStatus === 'qualified' ? 'is-korea-path' : 'is-korea-preview');
        }
        svg.append(path);
      }
    });
  };

  const cards = [...bracketNode.querySelectorAll('[data-match-id]')];
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  observer?.observe(bracketNode);
  cards.forEach((card) => observer?.observe(card));
  window.addEventListener('resize', draw);
  document.fonts?.ready.then(draw);
  draw();
  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener('resize', draw);
  };
}

function bracketView(bracket) {
  const validation = validateBracket(bracket);
  if (!validation.valid) {
    const node = el('section', { class: 'wc-bracket-error', role: 'alert' }, [
      el('strong', { text: '대진표 데이터를 표시할 수 없습니다.' }),
      el('p', { text: validation.errors.join(' ') }),
    ]);
    return { node, dispose: () => {} };
  }
  const node = el('div', { class: 'wc-bracket', role: 'region', 'aria-label': '2026 월드 챔피언십 토너먼트 대진표', tabindex: '0' }, [
    ...tournamentRounds.map((round, roundIndex) => el('section', { class: `wc-round wc-round--${round.roundId}`, 'aria-labelledby': `round-${round.roundId}` }, [
      el('header', { class: 'wc-round__header' }, [
        el('span', { text: 'KNOCKOUT' }),
        el('h2', { id: `round-${round.roundId}`, text: round.label }),
        el('b', { text: `${round.matchIds.length} MATCHES` }),
      ]),
      el('div', { class: 'wc-round__matches' }, [
        ...round.matchIds.map((id, matchIndex) => matchCard(bracket.matches.find(({ matchId }) => matchId === id), roundIndex, matchIndex)),
        ...(round.auxiliaryMatchIds ?? []).map((id) => matchCard(bracket.matches.find(({ matchId }) => matchId === id), roundIndex, 0)),
      ]),
    ])),
  ]);
  return { node, dispose: connectorLayer(bracket, node) };
}

/** 기존 /tournament 탭에 들어가는 대회 화면. */
export default function tournamentScreen(root, ctx, params = {}) {
  const candidateBracket = params.bracket ?? null;
  const savedBracket = candidateBracket && validateBracket(candidateBracket).valid ? candidateBracket : null;
  // 조 순위·대진표·탈락 여부는 저장된 경기 결과 하나에서 전부 파생한다.
  const progress = createGameProgress({
    groupAFinalResult: params.groupAFinalResult ?? null,
    knockoutResults: params.knockoutResults ?? [],
  });
  const groupState = progress.group;
  const qualificationStatus = groupState.qualificationStatus;
  const searchParams = new URLSearchParams(window.location.search);
  const requestedTimeline = searchParams.get('timeline');
  const requestedSubView = searchParams.get('view');
  let activeSubView = SUB_VIEWS.includes(requestedSubView) ? requestedSubView : 'group';
  let viewMode = requestedTimeline === 'current'
    ? 'current'
    : requestedTimeline === 'qualified'
      ? 'qualified-preview'
      : savedBracket?.timeline === 'official'
        ? 'current'
        : savedBracket?.timeline === 'game'
          ? 'qualified-preview'
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
  let disposeBracket = () => {};

  const renderView = () => {
    // 게임 시간선은 진행 상태가 만든 대진표가 유일한 원본이다 — 치른 경기 결과가 그대로 들어 있다.
    const bracket = viewMode === 'qualified-preview'
      ? progress.bracket
      : (savedBracket?.timeline === 'official' ? savedBracket : createOfficialBracket());
    currentButton.setAttribute('aria-pressed', String(viewMode === 'current'));
    previewButton.setAttribute('aria-pressed', String(viewMode === 'qualified-preview'));
    if (viewMode === 'qualified-preview') {
      statusBanner.className = qualificationStatus === 'qualified' ? 'wc-qualified-banner' : 'wc-pending-banner';
      statusBanner.textContent = qualificationStatus === 'qualified'
        ? (progress.status === 'eliminated'
            ? `대한민국은 ${progress.lastPlayed?.roundLabel ?? '토너먼트'}에서 여정을 마쳤습니다. 그 경기를 다시 치를 수 있습니다.`
            : progress.status === 'champion'
              ? '대한민국이 결승까지 모두 이기고 우승했습니다.'
              : `대한민국이 A조 2위로 32강에 진출했습니다. 다음 상대는 ${countries[progress.nextStep?.opponentTeamId ?? 'CAN'].nameKo}입니다.`)
        : qualificationStatus === 'eliminated'
          ? '대한민국은 A조 최종전에서 패배해 조별리그에서 탈락했습니다. 이 경로는 진출했을 경우의 예상입니다.'
          : '대한민국이 A조 2위로 진출할 경우의 예상 경로입니다. 진출 확정 전까지 Match 73의 홈팀은 미정입니다.';
    } else {
      statusBanner.className = 'wc-pending-banner';
      statusBanner.textContent = 'FIFA 공식 결과 기준의 현재 대진입니다. Match 73은 남아프리카공화국 대 캐나다입니다.';
    }
    disposeBracket();
    const view = bracketView(bracket);
    viewRoot.replaceChildren(view.node);
    disposeBracket = view.dispose;
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

  const groupView = groupStageView(groupState);
  const groupPanel = groupView.node;
  const knockoutPanel = el('section', { class: 'wc-bracket-section', id:'tournament-panel-knockout', role:'tabpanel', 'aria-labelledby':'tournament-tab-knockout' }, [
    el('div', { class: 'wc-bracket-toolbar' }, [
      el('div', {}, [el('p', { class: 'wc-eyebrow', text: 'TOURNAMENT BRACKET' }),el('h2', { text: '2026 대회 전체 대진' })]),
      el('div', { class: 'wc-timeline-switch', role: 'group', 'aria-label': '대진 시간선 보기' }, [currentButton, previewButton]),
    ]),
    statusBanner,viewRoot,el('p', { class: 'wc-scroll-hint', text: '좌우로 이동해 결승까지의 경로를 확인하세요.' }),
  ]);
  groupPanel.id = 'tournament-panel-group';
  groupPanel.setAttribute('role','tabpanel');
  groupPanel.setAttribute('aria-labelledby','tournament-tab-group');

  const tabButtons = {};
  const selectSubView = (nextView,{updateUrl=true}={}) => {
    if (!SUB_VIEWS.includes(nextView)) return;
    activeSubView = nextView;
    for (const key of SUB_VIEWS) {
      tabButtons[key].setAttribute('aria-selected',String(key===activeSubView));
      tabButtons[key].tabIndex = key===activeSubView ? 0 : -1;
    }
    groupPanel.hidden = activeSubView !== 'group';
    knockoutPanel.hidden = activeSubView !== 'knockout';
    if (activeSubView === 'knockout') renderView();
    else { disposeBracket(); disposeBracket=()=>{}; viewRoot.replaceChildren(); }
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('view',activeSubView);
      window.history.pushState({...window.history.state,route:'tournament'},'',`${url.pathname}${url.search}${url.hash}`);
    }
  };
  const onTabKeyDown = (event) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const index = SUB_VIEWS.indexOf(activeSubView);
    const next = event.key==='Home' ? 0 : event.key==='End' ? SUB_VIEWS.length-1 : (index+(event.key==='ArrowRight'?1:-1)+SUB_VIEWS.length)%SUB_VIEWS.length;
    selectSubView(SUB_VIEWS[next]);
    tabButtons[SUB_VIEWS[next]].focus();
  };
  const subTabs = el('div',{class:'wc-subtabs',role:'tablist','aria-label':'대회 단계',onkeydown:onTabKeyDown},SUB_VIEWS.map((key)=>{
    const button=el('button',{id:`tournament-tab-${key}`,class:'wc-subtab',type:'button',role:'tab',text:key==='group'?'조별리그':'토너먼트','aria-controls':`tournament-panel-${key}`,'aria-selected':String(key===activeSubView),tabindex:key===activeSubView?'0':'-1',onclick:()=>selectSubView(key)});
    tabButtons[key]=button; return button;
  }));
  const onViewPopState = () => {
    const requested = new URLSearchParams(window.location.search).get('view');
    selectSubView(SUB_VIEWS.includes(requested) ? requested : 'group',{updateUrl:false});
  };
  window.addEventListener('popstate',onViewPopState);

  const hero = el('header', { class: 'wc-hero' }, [
      el('div', { class: 'wc-hero__copy' }, [
        el('p', { class: 'wc-eyebrow', text: 'WORLD CHAMPIONSHIP · NORTH AMERICA 2026' }),
        el('h1', { text: '운명을 다시 쓰는 대회' }),
        el('p', { text: '조별리그 마지막 승부부터 결승까지, 모든 결과가 역사를 바꿉니다.' }),
      ]),
      currentMatchCard(progress,ctx,params.onRetry),
  ]);
  root.append(el('main', { class: 'screen tournament-screen' }, [
    hero,
    subTabs,groupPanel,knockoutPanel,
  ]));

  const activeStep = progress.activeStep;
  const activeStepPlayed = activeStep
    ? progress.played.some((entry)=>entry.matchId===activeStep.matchId)
    : true;
  const floatingPrepareButton = activeStep && !activeStepPlayed
    ? el('button',{
      type:'button',
      class:'wc-floating-prepare',
      text:`${shortName(activeStep.opponentTeamId)}전 준비하기 →`,
      hidden:true,
      'aria-label':`${countries[activeStep.opponentTeamId].nameKo}전 선수단 준비 화면으로 이동`,
      onclick:()=>ctx.navigate('roster'),
    })
    : null;
  const updateFloatingPrepare = () => {
    if (!floatingPrepareButton) return;
    const navigationHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-navigation-height')) || 62;
    floatingPrepareButton.hidden = hero.getBoundingClientRect().bottom > navigationHeight;
  };
  if (floatingPrepareButton) {
    document.querySelector('.top-navigation')?.append(floatingPrepareButton);
    window.addEventListener('scroll',updateFloatingPrepare,{passive:true});
    window.addEventListener('resize',updateFloatingPrepare);
    updateFloatingPrepare();
  }

  selectSubView(activeSubView,{updateUrl:false});
  return () => {
    groupView.dispose();
    disposeBracket();
    window.removeEventListener('popstate',onViewPopState);
    window.removeEventListener('scroll',updateFloatingPrepare);
    window.removeEventListener('resize',updateFloatingPrepare);
    floatingPrepareButton?.remove();
  };
}
