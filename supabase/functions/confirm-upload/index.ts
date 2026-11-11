// POST { media_id } → confirma no R2 que os ficheiros existem e marca como 'ready'.
// Se o álbum ainda não tiver capa, a primeira foto passa a ser a capa.
import { handler, HttpError, readJson, requireUuid } from '../_shared/http.ts';
import { admin, requireUser } from '../_shared/supabase.ts';
import { deleteObjects, headObject } from '../_shared/r2.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const mediaId = requireUuid((await readJson(req)).media_id);

  const { data: m, error } = await admin.from('media').select('*').eq('id', mediaId).maybeSingle();
  if (error) throw error;
  if (!m) throw new HttpError(404, 'not_found');
  if (m.uploaded_by !== user.id) throw new HttpError(403, 'forbidden');
  if (m.status === 'ready') return { media: m };

  const [mainSize, thumbSize] = await Promise.all([
    headObject(m.object_key),
    m.thumb_key ? headObject(m.thumb_key) : Promise.resolve(null),
  ]);
  if (mainSize === null) throw new HttpError(409, 'upload_missing');

  const actual = mainSize + (thumbSize ?? 0);
  if (actual > m.size_bytes) {
    // Não deveria acontecer (o tamanho está assinado), mas por segurança:
    await deleteObjects([m.object_key, m.thumb_key]);
    await admin.from('media').delete().eq('id', m.id);
    throw new HttpError(400, 'size_mismatch');
  }

  const { data: updated, error: upErr } = await admin
    .from('media')
    .update({
      status: 'ready',
      size_bytes: actual,
      thumb_key: thumbSize === null ? null : m.thumb_key, // miniatura falhou → sem miniatura
    })
    .eq('id', m.id)
    .select()
    .single();
  if (upErr) throw upErr;

  if (m.kind === 'photo') {
    await admin.from('albums')
      .update({ cover_media_id: m.id })
      .eq('id', m.album_id)
      .is('cover_media_id', null);
  }

  return { media: updated };
}));
