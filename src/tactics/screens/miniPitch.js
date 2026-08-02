/**
 * 전술 패널 오른쪽의 미니 배치도.
 *
 * 회색 점은 감독이 보드에 놓은 위치, 파란 점은 폭·깊이 지시가 반영된 위치다.
 * 두 점을 겹쳐 보여 주면 슬라이더를 만질 때 팀이 어떻게 벌어지고 올라가는지 바로 읽힌다.
 * 표시 전용이며 도메인 값을 바꾸지 않는다.
 */

import { el } from '../../shared/index.js';

const clampHalf = (n) => Math.min(0.48, Math.max(-0.48, n));

/** 편집기 보드와 같은 식으로 좌우를 벌린다(0.8 ~ 1.3배). */
const spreadOf = (width) => 0.8 + width * 0.5;

// 공격 방향이 위가 되도록 세운다. x가 클수록 위쪽이다.
const place = ({ x, z }) => ({ left: `${50 + z * 100}%`, top: `${50 - x * 100}%` });

export function createMiniPitch() {
  const dots = el('div', { class: 'mini-dots' });
  const node = el('div', { class: 'mini-pitch' }, [
    el('div', { class: 'mini-lines' }, [
      el('span', { class: 'mini-box top' }),
      el('span', { class: 'mini-goal top' }),
      el('span', { class: 'mini-half' }),
      el('span', { class: 'mini-circle' }),
      el('span', { class: 'mini-box bottom' }),
      el('span', { class: 'mini-goal bottom' }),
    ]),
    dots,
  ]);

  /**
   * @param {Array<{x:number, z:number, role:string}>} assignments 현재 선발 배치
   * @param {object} preset 현재 전술 프리셋 (attackWidth, depth 를 읽는다)
   * @param {number} width 파생된 전술 폭 0..1
   */
  function update(assignments, preset, width) {
    const spread = spreadOf(width);
    // 깊이 5~6을 중립으로 두고 라인 전체를 앞뒤로 민다.
    const push = ((preset.depth - 5.5) / 9) * 0.18;

    dots.replaceChildren(
      ...assignments.flatMap((a) => {
        const isGk = a.role === 'GK';
        const moved = {
          x: isGk ? a.x : clampHalf(a.x + push),
          z: clampHalf(a.z * spread),
        };
        return [
          el('i', { class: 'mini-dot base', style: place(a) }),
          el('i', { class: `mini-dot live${isGk ? ' gk' : ''}`, style: place(moved) }),
        ];
      })
    );
  }

  return { node, update };
}
