// POST { album_id, kind, mime, size, thumb_mime?, thumb_size?, width?, height?, duration_s?, taken_at?, title? }
// kind: 'photo' | 'video' | 'audio' (música de fundo do álbum, só o owner)
// → { media_id, upload: {url, headers}, thumb: {url, headers} | null }
//
// Verifica: login, membro do álbum, tipo/tamanho/duração e limite de espaço (9,5 GB).
import { handler, HttpError, readJson, requireUuid } from '../_shared/http.ts';
import { admin, getRole, requireUser } from '../_shared/supabase.ts';
import { presignPut } from '../_shared/r2.ts';
import {
  AUDIO_MAX_BYTES, EXT, PHOTO_MAX_BYTES, THUMB_EXT, THUMB_MAX_BYTES, UPLOAD_BLOCK_BYTES,
  VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS,
} from '../_shared/limits.ts';

const posInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const b = await readJson(req);

  const albumId = requireUuid(b.album_id);
  const kind = b.kind;
  if (kind !== 'photo' && kind !== 'video' && kind !== 'audio') throw new HttpError(400, 'bad_request');

  const role = await getRole(albumId, user.id);
  if (!role) throw new HttpError(403, 'not_a_member');
  if (kind === 'audio' && role !== 'owner') throw new HttpError(403, 'forbidden');

  const mime = String(b.mime ?? '');
  const ext = EXT[kind][mime];
  if (!ext) throw new HttpError(415, 'unsupported_type');

  const size = posInt(b.size);
  if (!size) throw new HttpError(400, 'bad_request');
  const maxBytes = kind === 'photo' ? PHOTO_MAX_BYTES : kind === 'video' ? VIDEO_MAX_BYTES : AUDIO_MAX_BYTES;
  if (size > maxBytes) {
    throw new HttpError(413, 'file_too_large');
  }

  let durationS: number | null = null;
  if (kind === 'video') {
    durationS = typeof b.duration_s === 'number' && b.duration_s > 0 ? b.duration_s : null;
    if (durationS === null) throw new HttpError(400, 'bad_request');
    if (durationS > VIDEO_MAX_SECONDS) throw new HttpError(400, 'video_too_long');
    durationS = Math.round(durationS * 100) / 100;
  }

  let thumbMime: string | null = null;
  let thumbSize = 0;
  if (b.thumb_mime && kind !== 'audio') {
    thumbMime = String(b.thumb_mime);
    if (!THUMB_EXT[thumbMime]) throw new HttpError(415, 'unsupported_type');
    thumbSize = posInt(b.thumb_size) ?? 0;
    if (!thumbSize || thumbSize > THUMB_MAX_BYTES) throw new HttpError(413, 'file_too_large');
  }

  let takenAt: string | null = null;
  if (typeof b.taken_at === 'string') {
    const d = new Date(b.taken_at);
    if (!isNaN(d.getTime())) takenAt = d.toISOString();
  }

  const { data: row, error } = await admin.rpc('reserve_media', {
    p_album_id: albumId,
    p_user_id: user.id,
    p_kind: kind,
    p_mime: mime,
    p_ext: ext,
    p_thumb_ext: thumbMime ? THUMB_EXT[thumbMime] : null,
    p_size_bytes: size + thumbSize,
    p_width: posInt(b.width),
    p_height: posInt(b.height),
    p_duration_s: durationS,
    p_taken_at: takenAt,
    p_block_bytes: UPLOAD_BLOCK_BYTES,
  });
  if (error) {
    if (error.message?.includes('quota_exceeded')) throw new HttpError(507, 'quota_exceeded');
    throw error;
  }

  if (kind === 'audio' && typeof b.title === 'string' && b.title.trim()) {
    await admin.from('media').update({ title: b.title.trim().slice(0, 200) }).eq('id', row.id);
  }

  const upload = await presignPut(row.object_key, mime, size);
  const thumb = row.thumb_key ? await presignPut(row.thumb_key, thumbMime!, thumbSize) : null;

  return { media_id: row.id, upload, thumb };
}));
