// Limites — manter em sincronia com supabase/functions/_shared/limits.ts
export const STORAGE_LIMIT_BYTES = 10e9; // 10 GB
export const UPLOAD_BLOCK_BYTES = 9.5e9; // bloqueio no servidor
export const STORAGE_WARN_RATIO = 0.8; // laranja
export const STORAGE_DANGER_RATIO = 0.95; // vermelho

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_TARGET_BYTES = 500_000;
export const THUMB_MAX_SIDE = 480;

export const VIDEO_MAX_BYTES = 30 * 1024 * 1024; // 30 MB
export const VIDEO_MAX_SECONDS = 30.5;
export const VIDEO_TARGET_SHORT_SIDE = 720; // 720p
export const VIDEO_BITRATE = 2_000_000; // ~7,5 MB para 30 s

export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];

export const SLIDESHOW_PHOTO_MS = 4500;
