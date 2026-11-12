// Campo "Local" com sugestões de cidades enquanto se escreve.
// Usa a API de pesquisa de lugares da Open-Meteo (gratuita, sem chave, em
// português). Continua a ser possível escrever qualquer texto à mão.
import { h, icon } from '../lib/dom.js';

const API = 'https://geocoding-api.open-meteo.com/v1/search';
const DEBOUNCE_MS = 250;

/** "PT" → 🇵🇹 */
function flag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Liga sugestões a um <input> que já está dentro de um .field */
export function attachPlaceSuggestions(input) {
  const list = h('ul', { class: 'suggest', role: 'listbox', hidden: true });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('spellcheck', 'false');
  input.enterKeyHint = 'done';

  let timer = null;
  let controller = null;
  let results = [];
  let active = -1;

  const hide = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  const choose = (r) => {
    // "Ponta Delgada, Portugal" — com a região só quando ajuda a distinguir
    input.value = [r.name, r.country].filter(Boolean).join(', ');
    hide();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const render = () => {
    if (!results.length) {
      hide();
      return;
    }
    list.replaceChildren(...results.map((r, i) =>
      h('li', { role: 'option', 'aria-selected': String(i === active) },
        h('button', {
          type: 'button',
          class: `suggest__item${i === active ? ' is-active' : ''}`,
          tabindex: '-1',
          // pointerdown em vez de click: escolhe antes de o campo perder o foco
          onpointerdown: (e) => {
            e.preventDefault();
            choose(r);
          },
        },
        h('span', { class: 'suggest__flag', 'aria-hidden': 'true' }, flag(r.country_code) || icon('pin', 16)),
        h('span', { class: 'suggest__text' },
          h('span', { class: 'suggest__name' }, r.name),
          h('span', { class: 'suggest__sub' }, [r.admin1, r.country].filter((x, j, a) => x && a.indexOf(x) === j).join(', ')))))));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  async function search(q) {
    controller?.abort();
    controller = new AbortController();
    try {
      const url = `${API}?name=${encodeURIComponent(q)}&count=6&language=pt&format=json`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      // Sem duplicados (mesmo nome, região e país)
      const seen = new Set();
      results = (data.results || []).filter((r) => {
        const key = `${r.name}|${r.admin1}|${r.country}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      active = -1;
      if (document.activeElement === input) render();
    } catch (e) {
      if (e.name !== 'AbortError') {
        results = [];
        hide(); // sem internet ou serviço em baixo: o campo continua a aceitar texto livre
      }
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      controller?.abort();
      results = [];
      hide();
      return;
    }
    timer = setTimeout(() => search(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
      render();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('focus', () => { if (results.length && input.value.trim().length >= 2) render(); });

  input.closest('.field')?.append(list);
  return input;
}
