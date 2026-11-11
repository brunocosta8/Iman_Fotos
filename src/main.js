import './styles/main.css';
import { isConfigured } from './config.js';
import { h } from './lib/dom.js';
import { startRouter, url } from './lib/router.js';
import { supabase } from './lib/supabase.js';

const app = document.getElementById('app');

// Rotas (as páginas são carregadas só quando são precisas, para a vista
// pública abrir depressa quando se encosta o telemóvel ao íman).
const routes = [
  [/^$/, () => import('./pages/home.js')],
  [/^a\/([A-Za-z0-9]{16})$/, () => import('./pages/album-public.js')],
  [/^album\/novo$/, () => import('./pages/album-new.js')],
  [/^album\/([0-9a-f-]{36})$/, () => import('./pages/album-manage.js')],
  [/^convite\/([A-Za-z0-9]{22})$/, () => import('./pages/invite.js')],
];

async function boot() {
  if (!isConfigured) {
    app.append(h('main', { class: 'container center narrow' },
      h('h1', {}, 'Configuração em falta'),
      h('p', { class: 'muted' }, 'Define VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e VITE_MEDIA_BASE_URL (ver README).')));
    return;
  }

  // Regresso do login Google (?code=…): o supabase-js troca o código pela
  // sessão; depois limpa-se o URL.
  await supabase.auth.getSession();
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error_description')) {
    if (params.has('error_description')) console.warn('Login:', params.get('error_description'));
    history.replaceState(null, '', location.pathname);
  }

  startRouter(app, routes);

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(url('sw.js'), { scope: url('') }).catch(() => {});
  }
}

boot();
