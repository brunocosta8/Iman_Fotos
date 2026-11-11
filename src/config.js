export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const MEDIA_BASE_URL = (import.meta.env.VITE_MEDIA_BASE_URL || '').replace(/\/+$/, '');

/** Caminho base da app ('/' em dev, '/<repo>/' no GitHub Pages). */
export const BASE = import.meta.env.BASE_URL;

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && MEDIA_BASE_URL);

/** URL público de um ficheiro no R2. */
export const mediaUrl = (key) => (key ? `${MEDIA_BASE_URL}/${key}` : null);
