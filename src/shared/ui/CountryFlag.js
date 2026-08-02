import { getCountryByTeamId, getFlagAssetByTeamId } from '../data/countryFlags.js';
import { el } from './dom.js';

const SIZES = new Set(['small', 'medium', 'large']);

/**
 * 검증된 로컬 SVG만 사용하는 공용 국기 컴포넌트.
 * teamId 사용을 우선한다. 화면은 SVG 경로나 ISO 코드를 직접 알 필요가 없다.
 * @param {{teamId:string, size?:'small'|'medium'|'large'}} props
 */
export function CountryFlag({ teamId, size = 'medium' }) {
  const country = getCountryByTeamId(teamId);
  const resolvedName = country?.nameKo ?? teamId ?? '국가';
  const normalizedSize = SIZES.has(size) ? size : 'medium';
  const fallbackText = country?.fifaCode ?? teamId ?? '—';
  const fallback = el('span', {
    class: 'country-flag__fallback',
    text: fallbackText,
    role: 'img',
    'aria-label': `${resolvedName} 국기`,
  });
  const src = getFlagAssetByTeamId(teamId);
  const wrapper = el('span', {
    class: `country-flag country-flag--${normalizedSize}${src ? ' has-asset' : ' is-error'}`,
  }, [fallback]);
  if (!src) return wrapper;

  fallback.setAttribute('aria-hidden', 'true');
  const image = el('img', {
    class: 'country-flag__image',
    src,
    alt: `${resolvedName} 국기`,
    width: 64,
    height: 48,
    loading: 'eager',
    decoding: 'async',
  });
  image.addEventListener('load', () => wrapper.classList.add('is-loaded'), { once: true });
  image.addEventListener('error', () => {
    wrapper.classList.add('is-error');
    fallback.removeAttribute('aria-hidden');
    image.remove();
  }, { once: true });
  wrapper.prepend(image);
  return wrapper;
}
