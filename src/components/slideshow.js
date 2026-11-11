// Visualizador em ecrã inteiro: deslizar, setas, botão "voltar" fecha,
// modo slideshow automático (fotos 4,5 s; vídeos até ao fim).
import { mediaUrl } from '../config.js';
import { h, icon } from '../lib/dom.js';
import { SLIDESHOW_PHOTO_MS } from '../lib/limits.js';

/**
 * @param {object[]} items  linhas de media (kind, object_key, thumb_key…)
 * @param {number} start
 * @param {{ autoplay?: boolean, actions?: (item, api) => {label, icon?, danger?, onClick}[] }} opts
 */
export function openSlideshow(items, start = 0, { autoplay = false, actions = null } = {}) {
  if (!items.length) return null;

  let index = start;
  let playing = false;
  let timer = null;
  let wakeLock = null;
  let closed = false;

  const counter = h('span', { class: 'ss__counter' });
  const playBtn = h('button', { class: 'ss__btn', type: 'button', onclick: () => setPlaying(!playing) });
  const closeBtn = h('button', { class: 'ss__btn', type: 'button', 'aria-label': 'Fechar', onclick: () => close() }, icon('close', 24));
  const prevBtn = h('button', { class: 'ss__nav ss__nav--prev', type: 'button', 'aria-label': 'Anterior', onclick: () => show(index - 1) }, icon('left', 28));
  const nextBtn = h('button', { class: 'ss__nav ss__nav--next', type: 'button', 'aria-label': 'Seguinte', onclick: () => show(index + 1) }, icon('right', 28));
  const stage = h('div', { class: 'ss__stage' });
  const actionsBar = h('div', { class: 'ss__actions' });

  const el = h('div', { class: 'ss', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Visualizador de fotos', tabindex: '-1' },
    h('div', { class: 'ss__top' }, counter, h('div', { class: 'ss__top-right' }, playBtn, closeBtn)),
    stage, prevBtn, nextBtn, actionsBar);

  document.body.append(el);
  document.body.classList.add('no-scroll');
  el.focus();

  // O botão/gesto "voltar" do telemóvel fecha o visualizador em vez de sair da página.
  history.pushState({ slideshow: true }, '');
  const onPop = () => close(true);
  addEventListener('popstate', onPop);

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === ' ' && e.target.tagName !== 'VIDEO') { e.preventDefault(); setPlaying(!playing); }
  };
  addEventListener('keydown', onKey);

  // Deslizar: esquerda/direita muda; para baixo fecha.
  let sx = 0, sy = 0, tracking = false;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; tracking = true; });
  stage.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) show(index + (dx < 0 ? 1 : -1));
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
  });
  stage.addEventListener('pointercancel', () => { tracking = false; });

  function current() { return items[index]; }

  function startPhotoTimer() {
    clearTimeout(timer);
    if (playing && current()?.kind === 'photo') timer = setTimeout(() => show(index + 1), SLIDESHOW_PHOTO_MS);
  }

  function show(i) {
    if (closed || !items.length) return;
    clearTimeout(timer);
    index = (i + items.length) % items.length;
    const item = items[index];
    counter.textContent = `${index + 1} / ${items.length}`;
    const single = items.length < 2;
    prevBtn.hidden = single;
    nextBtn.hidden = single;

    let node;
    if (item.kind === 'photo') {
      node = h('img', { class: 'ss__media', alt: '', decoding: 'async' });
      node.draggable = false;
      if (item.thumb_key) node.style.backgroundImage = `url("${mediaUrl(item.thumb_key)}")`;
      const ready = () => { node.style.backgroundImage = ''; if (items[index] === item) startPhotoTimer(); };
      node.addEventListener('load', ready, { once: true });
      node.addEventListener('error', ready, { once: true });
      node.src = mediaUrl(item.object_key);
    } else {
      node = h('video', {
        class: 'ss__media',
        src: mediaUrl(item.object_key),
        poster: item.thumb_key ? mediaUrl(item.thumb_key) : null,
        controls: true,
        playsinline: true,
        preload: 'auto',
      });
      node.addEventListener('ended', () => { if (playing) show(index + 1); });
      if (playing) playVideo(node);
    }
    stage.replaceChildren(node);
    preload(index + 1);
    preload(index - 1);
    renderActions();
  }

  function playVideo(v) {
    v.play().catch(() => {
      // Sem gesto do utilizador alguns browsers só deixam reproduzir sem som.
      v.muted = true;
      v.play().catch(() => {});
    });
  }

  function preload(i) {
    const it = items[(i + items.length) % items.length];
    if (it && it.kind === 'photo') new Image().src = mediaUrl(it.object_key);
  }

  function setPlaying(value) {
    playing = value;
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 22));
    playBtn.setAttribute('aria-label', playing ? 'Pausar slideshow' : 'Iniciar slideshow');
    el.classList.toggle('is-playing', playing);
    if (playing) {
      el.requestFullscreen?.().catch(() => {});
      navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
      const node = stage.firstChild;
      if (node?.tagName === 'VIDEO') {
        if (node.ended) show(index + 1);
        else playVideo(node);
      } else startPhotoTimer();
    } else {
      clearTimeout(timer);
      wakeLock?.release().catch(() => {});
      wakeLock = null;
    }
  }

  const api = {
    close: () => close(),
    /** Remove o item atual (ex.: depois de apagar). */
    removeCurrent() {
      items.splice(index, 1);
      if (!items.length) close();
      else show(index >= items.length ? 0 : index);
    },
    refreshActions: () => renderActions(),
  };

  function renderActions() {
    const list = actions ? actions(current(), api).filter(Boolean) : [];
    actionsBar.hidden = list.length === 0;
    actionsBar.replaceChildren(...list.map((a) =>
      h('button', {
        class: `ss__action${a.danger ? ' ss__action--danger' : ''}`,
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try { await a.onClick(current()); } finally { btn.disabled = false; }
        },
      }, a.icon && icon(a.icon, 18), a.label)));
  }

  function close(fromPopState = false) {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    wakeLock?.release().catch(() => {});
    removeEventListener('popstate', onPop);
    removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.remove();
    document.body.classList.remove('no-scroll');
    if (!fromPopState) history.back();
  }

  setPlaying(autoplay);
  show(index);
  return api;
}
