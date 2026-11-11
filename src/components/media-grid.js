import { mediaUrl } from '../config.js';
import { h, icon } from '../lib/dom.js';
import { formatDuration } from '../lib/format.js';

export function mediaGrid(items, onOpen) {
  return h('div', { class: 'grid' },
    items.map((m, i) => {
      const thumb = m.thumb_key || (m.kind === 'photo' ? m.object_key : null);
      return h('button', {
        class: 'tile',
        type: 'button',
        'aria-label': m.kind === 'video' ? `Vídeo ${i + 1}` : `Foto ${i + 1}`,
        onclick: () => onOpen(i),
      },
      thumb
        ? h('img', { src: mediaUrl(thumb), alt: '', loading: 'lazy', decoding: 'async' })
        : h('span', { class: 'tile__placeholder' }, icon('play', 28)),
      m.kind === 'video' &&
        h('span', { class: 'tile__badge' }, icon('play', 12), formatDuration(m.duration_s)));
    }));
}
