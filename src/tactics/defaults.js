// 전술 화면과 앱 상태가 공유하는 기본 전술 값.
// 이 객체는 공유 참조이므로 얼려서 실수로 전역 기본값이 바뀌는 일을 막는다.
export const TACTIC_DEFAULT = Object.freeze({
  lineHeight: 0.5,
  pressing: 0.5,
  tempo: 0.5,
  width: 0.5,
});

/** 항상 새 객체를 돌려준다. 상태에 넣을 값은 이 함수로 만든다. */
export function createDefaultTactics() {
  return { ...TACTIC_DEFAULT };
}
