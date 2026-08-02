/**
 * 상대 스카우팅 패널.
 *
 * 라인업 화면 아래에 붙어서 "다음 상대가 어떤 모양으로 서는가"를 보여 준다.
 * 왼쪽은 상대 포메이션 구상도, 오른쪽은 26인 명단이다.
 *
 * 상대 데이터는 tournament의 공개 API에서만 읽는다 — 여기서 팀을 만들지 않는다.
 * 좌표도 포메이션 정의에서 그대로 읽어 배치를 다시 적지 않는다.
 * 표시 전용이며, 다른 상대를 고르면 onSelect로만 알린다.
 */

import './lineup.css';
import { el } from '../../shared/index.js';
import { OPPONENT_TEAMS, getOpponentTeam } from '../../tournament/index.js';
import { getNormalizedSlots } from '../formations.js';
import { positionName, positionOf } from '../domain/roles.js';

const POS_ORDER = ['GK', 'DF', 'MF', 'FW'];
const POS_LABEL = { GK: '골키퍼', DF: '수비수', MF: '미드필더', FW: '공격수' };

/**
 * 상대 진영을 화면 위쪽에 두고 우리 골문 쪽(아래)으로 공격하게 그린다.
 * 감독이 보는 우리 보드와 마주 보는 그림이 되도록 앞뒤·좌우를 함께 뒤집는다.
 */
const place = ({ x, z }) => ({ top: `${(0.5 + x) * 100}%`, left: `${50 - z * 100}%` });

/**
 * 구상도에 적는 이름. 자리끼리 붙어 있어 성만 적는다.
 * 유럽 선수는 이름이 띄어쓰기로 나뉘므로 마지막 토막이 성이고,
 * 한국식 이름처럼 붙여 쓰는 이름은 그대로 남는다.
 */
const shortName = (player) => player.name.split(' ').at(-1);

/**
 * @param {object} [options]
 * @param {string} [options.stage] 처음 보여 줄 상대의 스테이지 id
 * @param {(team: object) => void} [options.onSelect] 다른 상대를 고르면 호출된다
 */
export function createOpponentScouting({ stage = null, onSelect = () => {} } = {}) {
  let current = getOpponentTeam(stage);

  const chips = el('div', { class: 'chips scout-chips' });
  const teamLine = el('div', { class: 'scout-team' });
  const shape = el('div', { class: 'scout-pitch' }, [
    el('div', { class: 'scout-lines' }, [
      el('span', { class: 'scout-box top' }),
      el('span', { class: 'scout-goal top' }),
      el('span', { class: 'scout-half' }),
      el('span', { class: 'scout-circle' }),
      el('span', { class: 'scout-box bottom' }),
      el('span', { class: 'scout-goal bottom' }),
    ]),
  ]);
  const dots = el('div', { class: 'scout-dots' });
  shape.append(dots);
  const styleNote = el('p', { class: 'lead small scout-style' });
  const squad = el('div', { class: 'scout-squad' });

  /** 대회에서 만나는 순서대로의 상대. 눌러서 어느 라운드 상대든 미리 볼 수 있다. */
  function drawChips() {
    chips.replaceChildren(
      ...OPPONENT_TEAMS.map((team) =>
        el('button', {
          class: `chip${team.id === current.id ? ' on' : ''}`,
          type: 'button',
          title: `${team.stageLabel} · ${team.name} (${team.formationId})`,
          text: `${team.stageLabel} ${team.shortName}`,
          onclick: () => select(team),
        })
      )
    );
  }

  function drawTeam() {
    teamLine.replaceChildren(
      el('span', { class: 'scout-code', text: current.code }),
      el('div', { class: 'scout-team-main' }, [
        el('b', { class: 'scout-name', text: `${current.name} · ${current.formationId}` }),
        el('span', { class: 'scout-sub', text: `${current.stageLabel} · 감독 ${current.coach}` }),
      ]),
      el('span', { class: 'scout-strength' }, [
        el('i', { text: '전력' }),
        el('b', { text: String(current.strength) }),
      ])
    );
    styleNote.textContent = current.style;
  }

  /** 상대 포메이션 구상도. 슬롯 좌표에 선수를 얹는다. */
  function drawShape() {
    const slots = getNormalizedSlots(current.formationId);
    dots.replaceChildren(
      ...slots.map((slot, i) => {
        const player = current.findById(current.startingXI[i]);
        const label = positionOf(slot);
        return el(
          'span',
          {
            class: `scout-dot ${slot.role}${player && player.id === current.captainId ? ' cap' : ''}`,
            style: place(slot),
            title: player
              ? `${label} ${positionName(label)} · ${player.name} (${player.club}) OVR ${player.stats.overall}`
              : `${label} ${positionName(label)}`,
          },
          [
            el('i', { class: 'scout-dot-num', text: player ? String(player.num) : '·' }),
            el('em', { class: 'scout-dot-name', text: player ? shortName(player) : label }),
          ]
        );
      })
    );
  }

  /** 오른쪽 명단. 선발 11인은 굵게, 나머지는 흐리게 둔다. */
  function drawSquad() {
    const starters = new Set(current.startingXI);
    squad.replaceChildren(
      el('div', { class: 'scout-squad-head' }, [
        el('span', { text: `${current.name} 26인` }),
        el('span', { class: 'scout-legend', text: '● 선발 11인' }),
      ]),
      ...POS_ORDER.flatMap((pos) => {
        const group = current.players
          .filter((p) => p.pos === pos)
          .sort((a, b) => Number(starters.has(b.id)) - Number(starters.has(a.id)) || a.num - b.num);
        if (group.length === 0) return [];

        return [
          el('div', { class: 'scout-group', text: `${POS_LABEL[pos]} ${group.length}` }),
          ...group.map((p) =>
            el('div', { class: `scout-row${starters.has(p.id) ? ' on' : ''}` }, [
              el('i', { class: 'scout-num', text: String(p.num) }),
              el('span', { class: 'scout-player' }, [
                el('b', { text: p.name }),
                el('span', { class: 'scout-club', text: p.club }),
              ]),
              el('i', { class: `pos ${p.pos} scout-pos`, text: p.detail || p.pos }),
              el('b', { class: 'scout-ovr', text: String(p.stats.overall) }),
            ])
          ),
        ];
      })
    );
  }

  function select(team) {
    if (team.id === current.id) return;
    current = team;
    render();
    onSelect(current);
  }

  function render() {
    drawChips();
    drawTeam();
    drawShape();
    drawSquad();
  }

  render();

  // 공용 base.css에 이미 `.scout`(경기 중 스카우팅 한 줄)이 있다. 이름이 겹치지 않게 둔다.
  const node = el('section', { class: 'scouting' }, [
    el('header', { class: 'scout-head' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow', text: 'SCOUTING' }),
        el('h3', { class: 'h3 scout-title', text: '다음 상대는 이렇게 선다' }),
      ]),
      chips,
    ]),
    el('div', { class: 'tactics-grid scout-grid' }, [
      el('section', { class: 'panel scout-panel' }, [teamLine, shape, styleNote]),
      el('section', { class: 'panel scout-panel' }, [squad]),
    ]),
  ]);

  return {
    node,
    /** 지금 보고 있는 상대 팀 */
    getTeam: () => current,
  };
}
