import { h, icon } from '../lib/dom.js';
import { url } from '../lib/router.js';
import { signInWithGoogle, signOut } from '../lib/supabase.js';
import { toast } from './toast.js';
import { errorMessage } from '../lib/api.js';

/** Barra de topo das páginas de gestão. */
export function topBar(session, { back = null } = {}) {
  const user = session?.user;
  const name = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '';
  const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return h('header', { class: 'topbar' },
    back
      ? h('a', { class: 'topbar__back', href: url(back.path), 'data-link': true }, icon('left', 20), back.label)
      : h('a', { class: 'topbar__brand', href: url(''), 'data-link': true },
          h('img', { src: url('icons/icon.svg'), alt: '', width: 28, height: 28 }), 'Ímanes'),
    user && h('div', { class: 'topbar__user' },
      avatar
        ? h('img', { class: 'avatar', src: avatar, alt: '', referrerpolicy: 'no-referrer' })
        : h('span', { class: 'avatar avatar--letter' }, name.slice(0, 1).toUpperCase()),
      h('button', {
        class: 'btn btn--ghost btn--small',
        type: 'button',
        onclick: async () => {
          await signOut();
          location.href = url('');
        },
      }, 'Sair')));
}

export function googleButton(label = 'Entrar com Google') {
  return h('button', {
    class: 'btn btn--google',
    type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const { error } = await signInWithGoogle();
      if (error) {
        btn.disabled = false;
        toast(errorMessage(error), { type: 'error' });
      }
    },
  }, googleLogo(), label);
}

function googleLogo() {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';
  return span;
}

export function emptyState(title, text, ...extra) {
  return h('div', { class: 'empty' }, h('p', { class: 'empty__title' }, title), text && h('p', { class: 'muted' }, text), ...extra);
}

/** Página para quem não tem sessão iniciada. */
export function loginRequired(view, message = 'Inicia sessão para continuar.') {
  view.append(
    topBar(null),
    h('main', { class: 'container center narrow' },
      h('h1', {}, 'Sessão necessária'),
      h('p', { class: 'muted' }, message),
      googleButton()));
}
