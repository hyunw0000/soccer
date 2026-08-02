import { flagAssets } from '../data/flagAssets.js';
import { el } from './dom.js';

const SIZES = new Set(['small', 'medium', 'large']);

/**
 * 검증된 로컬 SVG만 사용하는 공용 국기 컴포넌트.
 * @param {{iso2:string, countryName:string, fifaCode?:string, size?:'small'|'medium'|'large'}} props
 */
export function CountryFlag({ iso2, countryName, fifaCode = '', size = 'medium' }) {
  const normalizedCode = String(iso2 ?? '').toLowerCase();
  const normalizedSize = SIZES.has(size) ? size : 'medium';
  const fallbackText = fifaCode || normalizedCode.toUpperCase() || '—';
  const fallback = el('span', {
    class: 'country-flag__fallback',
    text: fallbackText,
    role: 'img',
    'aria-label': `${countryName} 국기`,
  });
  const wrapper = el('span', {
    class: `country-flag country-flag--${normalizedSize}`,
  }, [fallback]);
  const src = flagAssets[normalizedCode];
  if (!src) return wrapper;

  fallback.setAttribute('aria-hidden', 'true');
  const image = el('img', {
    class: 'country-flag__image',
    src,
    alt: `${countryName} 국기`,
    width: 64,
    height: 48,
    loading: 'eager',
    decoding: 'async',
  });
  image.addEventListener('load', () => wrapper.classList.add('is-loaded'), { once: true });
  image.addEventListener('error', () => {
    fallback.removeAttribute('aria-hidden');
    image.remove();
  }, { once: true });
  wrapper.prepend(image);
  return wrapper;
}
