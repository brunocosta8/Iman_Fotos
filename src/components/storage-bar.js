import { h } from '../lib/dom.js';
import { formatGB } from '../lib/format.js';
import {
  STORAGE_DANGER_RATIO, STORAGE_LIMIT_BYTES, STORAGE_WARN_RATIO, UPLOAD_BLOCK_BYTES,
} from '../lib/limits.js';
import { supabase } from '../lib/supabase.js';

export function storageBar(used) {
  const ratio = Math.min(1, used / STORAGE_LIMIT_BYTES);
  const level = ratio >= STORAGE_DANGER_RATIO ? 'danger' : ratio >= STORAGE_WARN_RATIO ? 'warn' : 'ok';
  const pct = Math.round(ratio * 100);

  let note = null;
  if (used >= UPLOAD_BLOCK_BYTES) note = 'Limite atingido: já não é possível carregar ficheiros. Apaga fotos ou vídeos para libertar espaço.';
  else if (level !== 'ok') note = 'O espaço está a acabar.';

  return h('section', { class: `storage storage--${level}`, 'aria-label': 'Espaço usado' },
    h('div', { class: 'storage__label' },
      h('span', {}, h('strong', {}, formatGB(used)), ' de 10 GB usados'),
      h('span', { class: 'muted' }, `${pct}%`)),
    h('div', {
      class: 'storage__track',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(pct),
    }, h('div', { class: 'storage__fill', style: { width: `${Math.max(ratio * 100, 1)}%` } })),
    note && h('p', { class: 'storage__note' }, note));
}

/** Indicador de espaço, ou null se o utilizador não for owner de nenhum álbum. */
export async function loadStorageBar() {
  const { data, error } = await supabase.rpc('storage_usage');
  if (error || data == null) return null;
  return storageBar(Number(data));
}
