// Visualizador estilo "Stories" (Instagram):
//  - barrinhas de progresso no topo; avança sozinho (fotos 5 s, vídeos até ao fim)
//  - tocar à direita avança, à esquerda recua; manter o dedo pausa
//  - deslizar para baixo (ou o botão "voltar" do telemóvel) fecha
//  - fundo com a própria foto desfocada, sem barras pretas
import { mediaUrl } from '../config.js';
import { h, icon } from '../lib/dom.js';
import { SLIDESHOW_PHOTO_MS } from '../lib/limits.js';

const MAX_SEGMENTS = 40; // acima disto mostra uma só barra com o progresso total
const HOLD_MS = 220;

const dateFmt = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * @param {object[]} items linhas de media (kind, object_key, thumb_key, taken_at…)
 * @param {number} start
 * @param {{ autoplay?: boolean, title?: string, actions?: (item, api) => {label, icon?, danger?, onClick}[] }} opts
 *   autoplay: aberto pelo botão "Slideshow" → tenta ecrã inteiro
 */
export function openSlideshow(items, start = 0, { autoplay = false, title = '', actions = null } = {}) {
  if (!items.length) return null;

  let index = start;
  let paused = false;
  let closed = false;
  let muted = false;
  let elapsed = 0;
  let lastTs = 0;
  let photoReady = false;
  let rafId = 0;
  let wakeLock = null;

  // ------------------------------------------------------------ elementos
  const bg = h('img', { class: 'st__bg', alt: '' });
  const stage = h('div', { class: 'st__stage' });
  const segmented = items.length <= MAX_SEGMENTS;
  const bars = h('div', { class: 'st__bars' });
  const dateEl = h('span');
  const muteBtn = h('button', {
    class: 'st__icon',
    type: 'button',
    hidden: true,
    onclick: () => setMuted(!muted),
  });
  const closeBtn = h('button', { class: 'st__icon', type: 'button', 'aria-label': 'Fechar', onclick: () => close() }, icon('close', 24));
  const prevBtn = h('button', { class: 'st__nav st__nav--prev', type: 'button', 'aria-label': 'Anterior', onclick: () => go(-1) }, icon('left', 26));
  const nextBtn = h('button', { class: 'st__nav st__nav--next', type: 'button', 'aria-label': 'Seguinte', onclick: () => go(1) }, icon('right', 26));
  const pausedBadge = h('div', { class: 'st__paused', 'aria-hidden': 'true' }, icon('pause', 30));
  const actionsBar = h('div', { class: 'st__actions' });

  const el = h('div', { class: 'st', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Fotos', tabindex: '-1' },
    bg,
    stage,
    h('div', { class: 'st__shade' }),
    h('div', { class: 'st__top' },
      bars,
      h('div', { class: 'st__head' },
        h('div', { class: 'st__title' }, title && h('strong', {}, title), dateEl),
        h('div', { class: 'st__head-btns' }, muteBtn, closeBtn))),
    pausedBadge,
    prevBtn,
    nextBtn,
    actionsBar);

  const fills = [];
  const segCount = segmented ? items.length : 1;
  for (let i = 0; i < segCount; i++) {
    const fill = h('span', { class: 'st__fill' });
    fills.push(fill);
    bars.append(h('span', { class: 'st__seg' }, fill));
  }

  document.body.append(el);
  document.body.classList.add('no-scroll');
  el.focus();

  if (autoplay) el.requestFullscreen?.().catch(() => {});
  navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});

  // O botão/gesto "voltar" do telemóvel fecha o visualizador.
  history.pushState({ slideshow: true }, '');
  const onPop = () => close(true);
  addEventListener('popstate', onPop);

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === ' ') { e.preventDefault(); setPaused(!paused, true); }
  };
  addEventListener('keydown', onKey);

  const onVisibility = () => {
    if (document.hidden) setPaused(true);
    else if (!el.classList.contains('is-paused-manual')) setPaused(false);
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ------------------------------------------------------------ gestos
  let sx = 0;
  let sy = 0;
  let pointerDown = false;
  let held = false;
  let holdTimer = null;

  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    pointerDown = true;
    held = false;
    sx = e.clientX;
    sy = e.clientY;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      setPaused(true);
      el.classList.add('is-holding');
    }, HOLD_MS);
  });
  el.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    clearTimeout(holdTimer);
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const swipeDown = dy > 90 && Math.abs(dy) > Math.abs(dx);
    if (held) {
      held = false;
      el.classList.remove('is-holding');
      setPaused(false);
      if (swipeDown) close();
      return;
    }
    if (swipeDown) close();
    else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) go(e.clientX < el.clientWidth / 3 ? -1 : 1);
  });
  el.addEventListener('pointercancel', () => {
    pointerDown = false;
    clearTimeout(holdTimer);
    if (held) {
      held = false;
      el.classList.remove('is-holding');
      setPaused(false);
    }
  });

  // ------------------------------------------------------------ lógica
  const current = () => items[index];
  const currentVideo = () => (stage.firstChild?.tagName === 'VIDEO' ? stage.firstChild : null);

  function setFill(progress) {
    const p = Math.max(0, Math.min(1, progress));
    if (segmented) fills[index].style.width = `${p * 100}%`;
    else fills[0].style.width = `${((index + p) / items.length) * 100}%`;
  }

  function tick(ts) {
    if (closed) return;
    if (!paused) {
      if (current().kind === 'photo') {
        if (photoReady) {
          if (lastTs) elapsed += ts - lastTs;
          lastTs = ts;
          const p = elapsed / SLIDESHOW_PHOTO_MS;
          setFill(p);
          if (p >= 1) {
            go(1);
            return;
          }
        }
      } else {
        const v = currentVideo();
        if (v?.duration) setFill(v.currentTime / v.duration);
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function go(delta) {
    show(index + delta);
  }

  function show(i) {
    if (closed || !items.length) return;
    cancelAnimationFrame(rafId);
    index = (i + items.length) % items.length;
    const item = current();
    elapsed = 0;
    lastTs = 0;
    photoReady = false;

    if (segmented) fills.forEach((f, j) => { f.style.width = j < index ? '100%' : '0%'; });
    setFill(0);

    dateEl.textContent = item.taken_at ? dateFmt.format(new Date(item.taken_at)) : '';
    const bgKey = item.thumb_key || (item.kind === 'photo' ? item.object_key : null);
    bg.hidden = !bgKey;
    if (bgKey) bg.src = mediaUrl(bgKey);

    let node;
    if (item.kind === 'photo') {
      node = h('img', { class: 'st__media', alt: '', decoding: 'async' });
      node.draggable = false;
      const ready = () => { photoReady = true; };
      node.addEventListener('load', ready, { once: true });
      node.addEventListener('error', ready, { once: true });
      node.src = mediaUrl(item.object_key);
      muteBtn.hidden = true;
    } else {
      node = h('video', {
        class: 'st__media',
        src: mediaUrl(item.object_key),
        poster: item.thumb_key ? mediaUrl(item.thumb_key) : null,
        playsinline: true,
        preload: 'auto',
      });
      node.muted = muted;
      node.addEventListener('ended', () => go(1));
      node.addEventListener('error', () => setTimeout(() => { if (current() === item) go(1); }, 1500));
      muteBtn.hidden = false;
      updateMuteBtn();
      if (!paused) playVideo(node);
    }
    stage.replaceChildren(node);
    preload(index + 1);
    preload(index - 1);
    renderActions();
    rafId = requestAnimationFrame(tick);
  }

  function playVideo(v) {
    v.play().catch(() => {
      // Sem gesto recente o browser só deixa reproduzir sem som.
      setMuted(true);
      v.play().catch(() => {});
    });
  }

  function setMuted(value) {
    muted = value;
    const v = currentVideo();
    if (v) v.muted = muted;
    updateMuteBtn();
  }

  function updateMuteBtn() {
    muteBtn.replaceChildren(icon(muted ? 'mute' : 'sound', 22));
    muteBtn.setAttribute('aria-label', muted ? 'Ligar som' : 'Desligar som');
  }

  function setPaused(value, manual = false) {
    paused = value;
    el.classList.toggle('is-paused-manual', value && manual);
    lastTs = 0;
    const v = currentVideo();
    if (v) {
      if (paused) v.pause();
      else playVideo(v);
    }
  }

  function preload(i) {
    const it = items[(i + items.length) % items.length];
    if (it?.kind === 'photo') new Image().src = mediaUrl(it.object_key);
  }

  const api = {
    close: () => close(),
    /** Remove o item atual (ex.: depois de apagar). */
    removeCurrent() {
      items.splice(index, 1);
      if (!items.length) {
        close();
        return;
      }
      if (segmented) {
        fills.splice(index, 1);
        bars.children[index]?.remove();
      }
      show(index >= items.length ? 0 : index);
    },
    refreshActions: () => renderActions(),
  };

  function renderActions() {
    const list = actions ? actions(current(), api).filter(Boolean) : [];
    actionsBar.hidden = list.length === 0;
    actionsBar.replaceChildren(...list.map((a) =>
      h('button', {
        class: `st__action${a.danger ? ' st__action--danger' : ''}`,
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          setPaused(true);
          try {
            await a.onClick(current());
          } finally {
            btn.disabled = false;
            if (!closed) setPaused(false);
          }
        },
      }, a.icon && icon(a.icon, 18), a.label)));
  }

  function close(fromPopState = false) {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(rafId);
    clearTimeout(holdTimer);
    currentVideo()?.pause();
    wakeLock?.release().catch(() => {});
    removeEventListener('popstate', onPop);
    removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.remove();
    document.body.classList.remove('no-scroll');
    if (!fromPopState) history.back();
  }

  show(index);
  return api;
}
