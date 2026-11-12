// Limites — manter em sincronia com src/lib/limits.js
export const STORAGE_LIMIT_BYTES = 10e9; // 10 GB (plano grátis R2)
export const UPLOAD_BLOCK_BYTES = 9.5e9; // uploads bloqueados a partir daqui

export const PHOTO_MAX_BYTES = 3_000_000; // o browser reduz para ~300–500 KB
export const THUMB_MAX_BYTES = 400_000;
export const VIDEO_MAX_BYTES = 30 * 1024 * 1024; // 30 MB
export const VIDEO_MAX_SECONDS = 30.5; // 30 s + margem de arredondamento
export const AUDIO_MAX_BYTES = 15 * 1024 * 1024; // música de fundo: 15 MB

export const EXT: Record<'photo' | 'video' | 'audio', Record<string, string>> = {
  photo: { 'image/webp': 'webp', 'image/jpeg': 'jpg' },
  video: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' },
  audio: { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' },
};
export const THUMB_EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };
