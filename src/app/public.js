// 기능 영역이 사용할 수 있는 앱 상태 공개 표면.
// app/main.js를 여기서 export하지 않아 기능 → 앱 → 기능 순환을 막는다.
export { state, setState, resetState, captain } from './state.js';
