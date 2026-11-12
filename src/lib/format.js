const LOCALE = 'pt-PT';

/** '2025-08-12' → Date local (sem desvio de fuso horário). */
export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const fmt = (d, opts) => new Intl.DateTimeFormat(LOCALE, opts).format(d);
const FULL = { day: 'numeric', month: 'long', year: 'numeric' };

/** "12–19 de agosto de 2025", "28 de julho – 3 de agosto de 2025", … */
export function formatDateRange(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s && !e) return '';
  if (!s || !e) return fmt(s || e, FULL);
  if (s.getTime() === e.getTime()) return fmt(s, FULL);
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth()) {
      return `${s.getDate()}–${e.getDate()} de ${fmt(s, { month: 'long' })} de ${s.getFullYear()}`;
    }
    return `${fmt(s, { day: 'numeric', month: 'long' })} – ${fmt(e, FULL)}`;
  }
  return `${fmt(s, FULL)} – ${fmt(e, FULL)}`;
}

/** Bytes → "1,2 GB" / "340 KB" (unidades decimais, como o R2). */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  const nf = (v, d) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: d }).format(v);
  if (n >= 1e9) return `${nf(n / 1e9, 2)} GB`;
  if (n >= 1e6) return `${nf(n / 1e6, 1)} MB`;
  return `${nf(Math.max(1, Math.round(n / 1e3)), 0)} KB`;
}

/** Bytes → "0,42 GB" (sempre em GB, para o indicador de espaço). */
export function formatGB(bytes) {
  const gb = (Number(bytes) || 0) / 1e9;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: gb < 10 ? 2 : 1 }).format(gb)} GB`;
}

/** 12.4 → "0:12" */
export function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "expira hoje" / "expira amanhã" / "expira daqui a 5 dias" */
export function formatExpiry(iso) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'expirado';
  if (days === 1) return 'expira em menos de 1 dia';
  return `expira daqui a ${days} dias`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Ordena como o servidor: ordem personalizada (se existir; fotos novas no fim),
 * depois data da foto (sem data no fim), depois data de envio.
 */
export function sortMedia(list, custom = false) {
  return list.sort((a, b) => {
    if (custom) {
      const ia = a.sort_index ?? Infinity;
      const ib = b.sort_index ?? Infinity;
      if (ia !== ib) return ia - ib;
    }
    const ta = a.taken_at ? Date.parse(a.taken_at) : Infinity;
    const tb = b.taken_at ? Date.parse(b.taken_at) : Infinity;
    if (ta !== tb) return ta - tb;
    return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0);
  });
}
