import { mediaUrl } from '../config.js';
import { emptyState, googleButton, topBar } from '../components/layout.js';
import { loadStorageBar } from '../components/storage-bar.js';
import { errorMessage } from '../lib/api.js';
import { h, icon, spinner } from '../lib/dom.js';
import { formatDateRange } from '../lib/format.js';
import { url } from '../lib/router.js';
import { getSession, supabase } from '../lib/supabase.js';

export default async function home(view) {
  const session = await getSession();
  if (!session) return landing(view);

  const storageSlot = h('div');
  const list = h('div', { class: 'album-list' }, spinner());

  view.append(
    topBar(session),
    h('main', { class: 'container' },
      storageSlot,
      h('div', { class: 'section-head' },
        h('h1', {}, 'Os meus álbuns'),
        h('a', { class: 'btn btn--primary', href: url('album/novo'), 'data-link': true }, icon('plus', 18), 'Novo álbum')),
      list));

  const [albumsRes, bar] = await Promise.all([
    supabase
      .from('albums')
      .select(`id, name, location, start_date, end_date,
               cover:media!albums_cover_media_id_fkey(object_key, thumb_key),
               album_members!inner(role)`)
      .eq('album_members.user_id', session.user.id)
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    loadStorageBar(),
  ]);

  if (bar) storageSlot.append(bar);

  if (albumsRes.error) {
    list.replaceChildren(h('p', { class: 'error' }, errorMessage(albumsRes.error)));
    return;
  }
  const albums = albumsRes.data;
  if (!albums.length) {
    list.replaceChildren(emptyState(
      'Ainda não tens álbuns',
      'Cria o primeiro álbum de uma viagem ou abre um link de convite que te tenham enviado.',
      h('a', { class: 'btn btn--primary', href: url('album/novo'), 'data-link': true }, icon('plus', 18), 'Criar álbum')));
    return;
  }

  list.replaceChildren(...albums.map(albumCard));
}

function albumCard(a) {
  const cover = a.cover?.thumb_key || a.cover?.object_key;
  const role = a.album_members?.[0]?.role;
  const dates = formatDateRange(a.start_date, a.end_date);
  return h('a', { class: 'album-card', href: url(`album/${a.id}`), 'data-link': true },
    h('div', { class: 'album-card__cover' },
      cover
        ? h('img', { src: mediaUrl(cover), alt: '', loading: 'lazy' })
        : h('span', { class: 'album-card__letter' }, a.name.slice(0, 1).toUpperCase())),
    h('div', { class: 'album-card__body' },
      h('h2', { class: 'album-card__title' }, a.name),
      dates && h('p', { class: 'meta' }, icon('calendar', 14), dates),
      a.location && h('p', { class: 'meta' }, icon('pin', 14), a.location),
      role === 'owner' && h('span', { class: 'chip' }, 'Criador')));
}

function landing(view) {
  view.append(
    h('main', { class: 'landing' },
      h('img', { class: 'landing__logo', src: url('icons/icon.svg'), alt: '', width: 96, height: 96 }),
      h('h1', {}, 'Ímanes de Viagem'),
      h('p', { class: 'landing__lead' },
        'Os álbuns das tuas viagens, guardados num íman do frigorífico. Encosta o telemóvel e as fotos abrem.'),
      googleButton('Entrar com Google para gerir álbuns'),
      h('p', { class: 'muted small' }, 'Para ver um álbum não precisas de conta: basta encostar o telemóvel ao íman.')));
}
