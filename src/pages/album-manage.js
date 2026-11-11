// Gestão de um álbum (só membros): link NFC, carregar fotos/vídeos, capa,
// membros, convites e (owner) editar / apagar.
import { mediaUrl } from '../config.js';
import { emptyState, loginRequired, topBar } from '../components/layout.js';
import { mediaGrid } from '../components/media-grid.js';
import { openSlideshow } from '../components/slideshow.js';
import { loadStorageBar } from '../components/storage-bar.js';
import { toast } from '../components/toast.js';
import { callFn, errorMessage } from '../lib/api.js';
import { copyText, shareOrCopy } from '../lib/clipboard.js';
import { h, icon, spinner } from '../lib/dom.js';
import { formatDateRange, formatExpiry, plural, sortMedia } from '../lib/format.js';
import { absoluteUrl, navigate, url } from '../lib/router.js';
import { getSession, supabase } from '../lib/supabase.js';
import { albumForm } from './album-new.js';

export default async function manageAlbum(view, albumId) {
  const session = await getSession();
  if (!session) return loginRequired(view, 'Inicia sessão para gerir este álbum.');
  const uid = session.user.id;

  view.append(topBar(session, { back: { path: '', label: 'Os meus álbuns' } }), h('div', { class: 'container' }, spinner()));

  const [albumRes, mediaRes, membersRes, invitesRes] = await Promise.all([
    supabase.from('albums')
      .select('id, slug, name, location, start_date, end_date, cover_media_id')
      .eq('id', albumId)
      .maybeSingle(),
    supabase.from('media')
      .select('id, kind, mime, object_key, thumb_key, width, height, duration_s, taken_at, created_at, uploaded_by')
      .eq('album_id', albumId)
      .eq('status', 'ready'),
    supabase.from('album_members')
      .select('user_id, role, joined_at, profile:profiles(display_name, avatar_url)')
      .eq('album_id', albumId)
      .order('joined_at'),
    activeInvites(albumId),
  ]);

  const firstError = albumRes.error || mediaRes.error || membersRes.error || invitesRes.error;
  if (firstError) throw firstError;

  if (!albumRes.data) {
    view.replaceChildren(
      topBar(session, { back: { path: '', label: 'Os meus álbuns' } }),
      h('main', { class: 'container center narrow' },
        h('h1', {}, 'Álbum não encontrado'),
        h('p', { class: 'muted' }, 'Este álbum não existe ou não és membro dele.')));
    return;
  }

  // ---------------------------------------------------------------- estado
  const album = albumRes.data;
  const media = sortMedia(mediaRes.data);
  let members = membersRes.data;
  let invites = invitesRes.data;
  const role = members.find((m) => m.user_id === uid)?.role;
  const isOwner = role === 'owner';
  let editing = false;
  let uploading = 0;

  document.title = `${album.name} · Ímanes`;

  // ---------------------------------------------------------------- secções
  const heroSlot = h('div');
  const storageSlot = h('div');
  const queue = h('ul', { class: 'queue' });
  const mediaSlot = h('section', { class: 'card' });
  const membersSlot = h('section', { class: 'card' });
  const invitesSlot = h('section', { class: 'card' });
  const dangerSlot = h('section', { class: 'card card--danger' });

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*,video/*',
    multiple: true,
    hidden: true,
    onchange: () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (files.length) handleFiles(files);
    },
  });

  view.replaceChildren(
    topBar(session, { back: { path: '', label: 'Os meus álbuns' } }),
    h('main', { class: 'container stack' },
      heroSlot,
      nfcCard(),
      h('section', { class: 'card' },
        h('h2', { class: 'card__title' }, icon('upload', 18), 'Adicionar fotos e vídeos'),
        h('p', { class: 'muted small' }, 'As fotos são reduzidas no telemóvel antes do envio. Vídeos até 30 segundos.'),
        h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => fileInput.click() },
          icon('plus', 18), 'Escolher fotos e vídeos'),
        fileInput,
        queue,
        storageSlot),
      mediaSlot,
      membersSlot,
      invitesSlot,
      dangerSlot));

  renderHero();
  renderMedia();
  renderMembers();
  renderInvites();
  renderDanger();
  if (isOwner) refreshStorage();

  const onBeforeUnload = (e) => {
    if (uploading > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  addEventListener('beforeunload', onBeforeUnload);
  return () => removeEventListener('beforeunload', onBeforeUnload);

  // ================================================================ hero
  function renderHero() {
    if (editing) {
      const form = albumForm({
        album,
        submitLabel: 'Guardar',
        onCancel: () => { editing = false; renderHero(); },
      });
      form.el.addEventListener('submit', async (e) => {
        e.preventDefault();
        const values = form.values();
        if (!values) return;
        form.setBusy(true);
        const { data, error } = await supabase.from('albums')
          .update(values.fields)
          .eq('id', album.id)
          .select('name, location, start_date, end_date')
          .single();
        if (error) {
          form.setBusy(false);
          toast(errorMessage(error), { type: 'error' });
          return;
        }
        Object.assign(album, data);
        document.title = `${album.name} · Ímanes`;
        editing = false;
        renderHero();
        toast('Álbum atualizado', { type: 'success' });
      });

      const coverInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
      coverInput.addEventListener('change', async () => {
        const file = coverInput.files[0];
        coverInput.value = '';
        if (!file) return;
        const m = await handleFiles([file]);
        if (m[0]) await setCover(m[0]);
      });

      heroSlot.replaceChildren(h('section', { class: 'card' },
        h('h2', { class: 'card__title' }, icon('edit', 18), 'Editar álbum'),
        form.el,
        h('div', { class: 'cover-tools' },
          h('p', { class: 'muted small' }, 'Capa: abre uma foto do álbum e toca em «Usar como capa», ou carrega uma nova.'),
          h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => coverInput.click() },
            icon('image', 16), 'Carregar nova capa'),
          coverInput)));
      return;
    }

    const cover = media.find((m) => m.id === album.cover_media_id);
    const dates = formatDateRange(album.start_date, album.end_date);
    heroSlot.replaceChildren(
      h('header', { class: 'manage-hero' },
        h('div', { class: 'manage-hero__cover' },
          cover
            ? h('img', { src: mediaUrl(cover.object_key), alt: '' })
            : h('span', { class: 'album-card__letter' }, album.name.slice(0, 1).toUpperCase())),
        h('div', { class: 'manage-hero__body' },
          h('h1', {}, album.name),
          dates && h('p', { class: 'meta' }, icon('calendar', 14), dates),
          album.location && h('p', { class: 'meta' }, icon('pin', 14), album.location),
          h('div', { class: 'button-row' },
            h('a', { class: 'btn btn--small', href: url(`a/${album.slug}`), 'data-link': true }, icon('eye', 16), 'Ver álbum'),
            isOwner && h('button', {
              class: 'btn btn--small btn--ghost',
              type: 'button',
              onclick: () => { editing = true; renderHero(); },
            }, icon('edit', 16), 'Editar')))));
  }

  // ================================================================ NFC
  function nfcCard() {
    const link = () => absoluteUrl(`a/${album.slug}`);
    const code = h('code', { class: 'nfc__url' }, link());
    nfcCard.update = () => { code.textContent = link(); };
    return h('section', { class: 'card nfc' },
      h('h2', { class: 'card__title' }, icon('nfc', 18), 'Link para a tag NFC'),
      code,
      h('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        onclick: () => copyText(link(), 'Link copiado — agora grava-o na tag'),
      }, icon('copy', 18), 'Copiar link para a tag NFC'),
      h('details', { class: 'nfc__help' },
        h('summary', {}, 'Como gravar o link no íman'),
        h('ol', {},
          h('li', {}, 'Instala uma app de NFC, por exemplo a «NFC Tools» (Android e iPhone).'),
          h('li', {}, 'Escolhe Escrever → Adicionar registo → URL/URI e cola o link.'),
          h('li', {}, 'Toca em Escrever e encosta o telemóvel à tag (NTAG213) atrás do íman.'),
          h('li', {}, 'Podes gravar o mesmo link em vários ímanes. Não bloqueies a tag, para a poderes regravar.'))));
  }

  // ================================================================ média
  function renderMedia() {
    const photos = media.filter((m) => m.kind === 'photo').length;
    const videos = media.length - photos;
    const summary = [photos && plural(photos, 'foto', 'fotos'), videos && plural(videos, 'vídeo', 'vídeos')]
      .filter(Boolean).join(' · ');

    mediaSlot.replaceChildren(
      h('div', { class: 'section-head' },
        h('h2', { class: 'card__title' }, icon('image', 18), 'Fotos e vídeos'),
        media.length > 0 && h('button', {
          class: 'btn btn--small',
          type: 'button',
          onclick: () => openViewer(0, true),
        }, icon('play', 14), 'Slideshow')),
      summary && h('p', { class: 'muted small' }, summary),
      media.length
        ? mediaGrid(media, (i) => openViewer(i, false))
        : emptyState('Ainda não há fotos', 'Adiciona as primeiras fotos e vídeos da viagem.'));
  }

  function openViewer(index, autoplay) {
    // O visualizador recebe uma cópia; as ações atualizam a lista real.
    openSlideshow([...media], index, {
      autoplay,
      actions: (item, api) => [
        isOwner && item.kind === 'photo' && item.id !== album.cover_media_id && {
          label: 'Usar como capa',
          icon: 'star',
          onClick: async () => {
            if (await setCover(item)) api.refreshActions();
          },
        },
        isOwner && item.kind === 'photo' && item.id === album.cover_media_id && {
          label: 'É a capa',
          icon: 'star',
          onClick: () => {},
        },
        (isOwner || item.uploaded_by === uid) && {
          label: 'Apagar',
          icon: 'trash',
          danger: true,
          onClick: async () => {
            if (!confirm(item.kind === 'video' ? 'Apagar este vídeo?' : 'Apagar esta foto?')) return;
            try {
              await callFn('delete-media', { media_id: item.id });
            } catch (err) {
              toast(errorMessage(err), { type: 'error' });
              return;
            }
            const i = media.findIndex((m) => m.id === item.id);
            if (i >= 0) media.splice(i, 1);
            if (album.cover_media_id === item.id) album.cover_media_id = null;
            api.removeCurrent();
            renderMedia();
            renderHero();
            if (isOwner) refreshStorage();
            toast('Apagado');
          },
        },
      ],
    });
  }

  async function setCover(item) {
    const { error } = await supabase.from('albums').update({ cover_media_id: item.id }).eq('id', album.id);
    if (error) {
      toast(errorMessage(error), { type: 'error' });
      return false;
    }
    album.cover_media_id = item.id;
    renderHero();
    toast('Capa atualizada', { type: 'success' });
    return true;
  }

  async function refreshStorage() {
    const bar = await loadStorageBar();
    storageSlot.replaceChildren(...(bar ? [bar] : []));
  }

  /** Envia ficheiros um a um; devolve as linhas de media criadas. */
  async function handleFiles(files) {
    const { uploadFile } = await import('../lib/upload.js');
    const rows = files.map((file) => {
      const label = h('span', { class: 'queue__status' }, 'Em espera');
      const bar = h('span', { class: 'queue__bar' });
      const li = h('li', { class: 'queue__item' },
        h('span', { class: 'queue__name' }, file.name || 'ficheiro'),
        label,
        h('span', { class: 'queue__track' }, bar));
      queue.append(li);
      return { file, li, label, bar };
    });

    const created = [];
    uploading += 1;
    for (const row of rows) {
      const set = (text, progress) => {
        row.label.textContent = text;
        if (progress != null) row.bar.style.width = `${Math.round(progress * 100)}%`;
      };
      try {
        const m = await uploadFile(album.id, row.file, ({ phase, progress }) => {
          if (phase === 'prepare') set('A preparar…', 0.02);
          else if (phase === 'convert') set(`A reduzir vídeo ${Math.round((progress || 0) * 100)}%`, (progress || 0) * 0.5);
          else if (phase === 'upload') set(`A enviar ${Math.round((progress || 0) * 100)}%`, 0.5 + (progress || 0) * 0.5);
          else if (phase === 'confirm') set('A concluir…', 1);
        });
        created.push(m);
        media.push(m);
        sortMedia(media);
        if (m.kind === 'photo' && !album.cover_media_id) album.cover_media_id = m.id; // capa automática
        row.li.classList.add('is-done');
        set('Concluído', 1);
        renderMedia();
        setTimeout(() => row.li.remove(), 2500);
      } catch (err) {
        row.li.classList.add('is-error');
        set(errorMessage(err));
        row.li.append(h('button', {
          class: 'queue__dismiss',
          type: 'button',
          'aria-label': 'Fechar',
          onclick: () => row.li.remove(),
        }, icon('close', 14)));
        if (err?.code === 'quota_exceeded') break;
      }
    }
    uploading -= 1;
    if (!editing) renderHero();
    if (isOwner) refreshStorage();
    return created;
  }

  // ================================================================ membros
  function renderMembers() {
    membersSlot.replaceChildren(
      h('h2', { class: 'card__title' }, icon('users', 18), 'Participantes'),
      h('ul', { class: 'people' },
        members.map((m) => {
          const name = m.profile?.display_name || 'Sem nome';
          return h('li', { class: 'people__item' },
            m.profile?.avatar_url
              ? h('img', { class: 'avatar', src: m.profile.avatar_url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
              : h('span', { class: 'avatar avatar--letter' }, name.slice(0, 1).toUpperCase()),
            h('span', { class: 'people__name' }, name, m.user_id === uid && h('span', { class: 'muted' }, ' (tu)')),
            h('span', { class: 'chip' }, m.role === 'owner' ? 'Criador' : 'Participante'),
            isOwner && m.user_id !== uid && h('button', {
              class: 'icon-btn',
              type: 'button',
              'aria-label': `Remover ${name}`,
              onclick: () => removeMember(m, name),
            }, icon('close', 16)));
        })));
  }

  async function removeMember(m, name) {
    if (!confirm(`Remover ${name} do álbum? As fotos que carregou ficam no álbum.`)) return;
    const { error } = await supabase.from('album_members').delete()
      .eq('album_id', album.id).eq('user_id', m.user_id);
    if (error) {
      toast(errorMessage(error), { type: 'error' });
      return;
    }
    members = members.filter((x) => x.user_id !== m.user_id);
    renderMembers();
  }

  // ================================================================ convites
  function renderInvites() {
    invitesSlot.replaceChildren(
      h('h2', { class: 'card__title' }, icon('link', 18), 'Convidar participantes'),
      h('p', { class: 'muted small' }, 'Quem abrir o link de convite e entrar com Google passa a poder adicionar fotos e vídeos. Os links expiram ao fim de 7 dias.'),
      h('button', { class: 'btn btn--block', type: 'button', onclick: createInvite }, icon('plus', 18), 'Criar link de convite'),
      invites.length > 0 && h('ul', { class: 'invites' },
        invites.map((inv) => {
          const link = absoluteUrl(`convite/${inv.token}`);
          return h('li', { class: 'invites__item' },
            h('code', { class: 'invites__url' }, link),
            h('p', { class: 'muted small' },
              `${formatExpiry(inv.expires_at)} · usado ${plural(inv.use_count, 'vez', 'vezes')}`),
            h('div', { class: 'button-row' },
              h('button', { class: 'btn btn--small', type: 'button', onclick: () => shareOrCopy(link, `Convite: ${album.name}`) },
                icon('share', 16), 'Partilhar'),
              h('button', { class: 'btn btn--small btn--ghost', type: 'button', onclick: () => copyText(link, 'Convite copiado') },
                icon('copy', 16), 'Copiar'),
              (isOwner || inv.created_by === uid) && h('button', {
                class: 'btn btn--small btn--ghost btn--danger-text',
                type: 'button',
                onclick: () => revokeInvite(inv),
              }, 'Cancelar')));
        })));
  }

  async function createInvite() {
    const { data, error } = await supabase.from('album_invites')
      .insert({ album_id: album.id })
      .select('id, token, expires_at, use_count, created_by')
      .single();
    if (error) {
      toast(errorMessage(error), { type: 'error' });
      return;
    }
    invites = [data, ...invites];
    renderInvites();
    shareOrCopy(absoluteUrl(`convite/${data.token}`), `Convite: ${album.name}`);
  }

  async function revokeInvite(inv) {
    if (!confirm('Cancelar este link de convite? Quem ainda não o usou deixa de poder entrar.')) return;
    const { error } = await supabase.from('album_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inv.id);
    if (error) {
      toast(errorMessage(error), { type: 'error' });
      return;
    }
    invites = invites.filter((x) => x.id !== inv.id);
    renderInvites();
  }

  // ================================================================ zona de perigo
  function renderDanger() {
    if (!isOwner) {
      dangerSlot.replaceChildren(
        h('button', { class: 'btn btn--ghost btn--danger-text btn--block', type: 'button', onclick: leaveAlbum }, icon('logout', 18), 'Sair do álbum'));
      return;
    }
    dangerSlot.replaceChildren(
      h('h2', { class: 'card__title' }, 'Zona de perigo'),
      h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: regenerateLink }, icon('refresh', 18), 'Gerar novo link público'),
      h('p', { class: 'muted small' }, 'Usa só se o link tiver sido partilhado com quem não devia. Os ímanes antigos deixam de funcionar até serem regravados.'),
      h('button', { class: 'btn btn--danger btn--block', type: 'button', onclick: deleteAlbum }, icon('trash', 18), 'Apagar álbum'));
  }

  async function leaveAlbum() {
    if (!confirm('Sair deste álbum? As fotos que carregaste ficam no álbum.')) return;
    const { error } = await supabase.from('album_members').delete()
      .eq('album_id', album.id).eq('user_id', uid);
    if (error) {
      toast(errorMessage(error), { type: 'error' });
      return;
    }
    navigate('', { replace: true });
  }

  async function regenerateLink() {
    if (!confirm('Gerar um novo link? O link atual deixa de funcionar e TODOS os ímanes deste álbum terão de ser regravados.')) return;
    const { data, error } = await supabase.rpc('regenerate_slug', { p_album_id: album.id });
    if (error) {
      toast(errorMessage(error), { type: 'error' });
      return;
    }
    album.slug = data;
    nfcCard.update();
    renderHero();
    toast('Novo link gerado. Grava-o nos ímanes.', { type: 'success', ms: 5000 });
  }

  async function deleteAlbum() {
    const typed = prompt(`Isto apaga o álbum e TODAS as fotos e vídeos, sem volta.\n\nPara confirmar, escreve o nome do álbum:\n${album.name}`);
    if (typed == null) return;
    if (typed.trim() !== album.name.trim()) {
      toast('O nome não corresponde. Nada foi apagado.', { type: 'error' });
      return;
    }
    try {
      await callFn('delete-album', { album_id: album.id });
    } catch (err) {
      toast(errorMessage(err), { type: 'error' });
      return;
    }
    toast('Álbum apagado');
    navigate('', { replace: true });
  }
}

function activeInvites(albumId) {
  return supabase.from('album_invites')
    .select('id, token, expires_at, use_count, created_by')
    .eq('album_id', albumId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
}
