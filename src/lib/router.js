import { BASE } from '../config.js';
import { h } from './dom.js';

let routes = [];
let root = null;
let lastPath = null;
let cleanup = null;

/** Caminho interno → URL da app ('album/x' → '/repo/album/x'). */
export const url = (path = '') => BASE + String(path).replace(/^\/+/, '');
/** URL absoluto (para tags NFC e convites). */
export const absoluteUrl = (path = '') => location.origin + url(path);

function currentPath() {
  let p = decodeURI(location.pathname);
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  else if (`${p}/` === BASE) p = '';
  return p.replace(/^\/+|\/+$/g, '');
}

export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', url(path));
  render();
}

/** Volta a desenhar a página atual. */
export function refresh() {
  render(true);
}

async function render(force = false) {
  const path = currentPath();
  // O slideshow usa o histórico para o botão "voltar": mesmo caminho → nada a fazer.
  if (!force && path === lastPath) return;
  lastPath = path;

  if (cleanup) {
    try { cleanup(); } catch { /* ignorar */ }
    cleanup = null;
  }

  const view = h('div', { class: 'view' });
  root.replaceChildren(view);
  window.scrollTo(0, 0);
  document.title = 'Ímanes de Viagem';

  for (const [re, load] of routes) {
    const m = path.match(re);
    if (!m) continue;
    try {
      const page = (await load()).default;
      const result = await page(view, ...m.slice(1));
      if (typeof result === 'function') {
        if (view.isConnected) cleanup = result;
        else result();
      }
    } catch (err) {
      console.error(err);
      view.replaceChildren(
        h('main', { class: 'container center' },
          h('h1', {}, 'Algo correu mal'),
          h('p', { class: 'muted' }, 'Verifica a ligação à internet e tenta outra vez.'),
          h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Recarregar')),
      );
    }
    return;
  }

  view.append(
    h('main', { class: 'container center' },
      h('h1', {}, 'Página não encontrada'),
      h('a', { class: 'btn', href: url(''), 'data-link': true }, 'Ir para o início')),
  );
}

export function startRouter(el, routeTable) {
  root = el;
  routes = routeTable;
  addEventListener('popstate', () => render());
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    history.pushState(null, '', a.getAttribute('href'));
    render();
  });
  render();
}
