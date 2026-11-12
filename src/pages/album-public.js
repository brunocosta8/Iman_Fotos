// Vista pública do álbum (o link gravado nas tags NFC). Não precisa de login.
import { mediaUrl } from '../config.js';
import { mediaGrid } from '../components/media-grid.js';
import { openSlideshow } from '../components/slideshow.js';
import { h, icon, spinner } from '../lib/dom.js';
import { formatDateRange, plural } from '../lib/format.js';
import { url } from '../lib/router.js';
import { getSession, supabase } from '../lib/supabase.js';

export default async function publicAlbum(view, slug) {
  view.append(h('div', { class: 'container' }, spinner('A abrir o álbum…')));

  const { data: album, error } = await supabase.rpc('get_public_album', { p_slug: slug });

  if (error) {
    view.replaceChildren(h('main', { class: 'container center narrow' },
      h('h1', {}, 'Não foi possível abrir o álbum'),
      h('p', { class: 'muted' }, 'Verifica a ligação à internet e tenta outra vez.'),
      h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Tentar outra vez')));
    return;
  }
  if (!album) {
    view.replaceChildren(h('main', { class: 'container center narrow' },
      h('h1', {}, 'Álbum não encontrado'),
      h('p', { class: 'muted' }, 'Este link já não existe ou foi alterado. Se o íman é teu, grava o novo link na tag.')));
    return;
  }

  document.title = `${album.name} · Ímanes`;
  const items = album.media;
  const photos = items.filter((m) => m.kind === 'photo').length;
  const videos = items.length - photos;
  const dates = formatDateRange(album.start_date, album.end_date);
  const coverKey = album.cover?.object_key;

  const manageSlot = h('div', { class: 'public__manage' });

  view.replaceChildren(
    h('header', { class: `hero${coverKey ? '' : ' hero--plain'}` },
      coverKey && h('img', {
        class: 'hero__img',
        src: mediaUrl(coverKey),
        alt: '',
        style: album.cover.thumb_key ? { backgroundImage: `url("${mediaUrl(album.cover.thumb_key)}")` } : null,
      }),
      h('div', { class: 'hero__content' },
        h('h1', { class: 'hero__title' }, album.name),
        dates && h('p', { class: 'hero__meta' }, icon('calendar', 16), dates),
        album.location && h('p', { class: 'hero__meta' }, icon('pin', 16), album.location))),
    h('main', { class: 'container sheet' },
      h('div', { class: 'public__bar' },
        h('p', { class: 'muted' }, [
          photos && plural(photos, 'foto', 'fotos'),
          videos && plural(videos, 'vídeo', 'vídeos'),
        ].filter(Boolean).join(' · ') || 'Sem fotos'),
        items.length > 0 && h('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: () => openSlideshow(items, 0, { autoplay: true, title: album.name }),
        }, icon('play', 16), 'Slideshow')),
      items.length
        ? mediaGrid(items, (i) => openSlideshow(items, i, { title: album.name }))
        : h('p', { class: 'empty muted' }, 'Ainda não há fotos neste álbum.'),
      manageSlot));

  // Pré-visualização pedida a partir da gestão: faixa no topo e sem atalhos de gestão.
  if (new URLSearchParams(location.search).has('convidado')) {
    view.prepend(h('div', { class: 'preview-banner', role: 'status' },
      h('span', { class: 'preview-banner__text' }, icon('eye', 16), 'Vista de convidado'),
      h('a', { class: 'preview-banner__back', href: url(`album/${album.id}`), 'data-link': true }, 'Voltar')));
    return;
  }

  // Se quem abriu for membro, mostra um atalho para gerir.
  const session = await getSession();
  if (session) {
    const { data } = await supabase.from('albums').select('id').eq('id', album.id).maybeSingle();
    if (data) {
      manageSlot.append(h('a', { class: 'btn btn--ghost', href: url(`album/${album.id}`), 'data-link': true }, icon('edit', 16), 'Gerir este álbum'));
    }
  }
}
