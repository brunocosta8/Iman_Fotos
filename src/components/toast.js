import { h } from '../lib/dom.js';

export function toast(message, { type = 'info', ms = 3200 } = {}) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
