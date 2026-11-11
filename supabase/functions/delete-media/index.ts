// POST { media_id } → apaga do R2 e da BD. Só quem carregou ou o owner do álbum.
import { handler, HttpError, readJson, requireUuid } from '../_shared/http.ts';
import { admin, getRole, requireUser } from '../_shared/supabase.ts';
import { deleteObjects } from '../_shared/r2.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const mediaId = requireUuid((await readJson(req)).media_id);

  const { data: m, error } = await admin
    .from('media')
    .select('id, album_id, uploaded_by, object_key, thumb_key')
    .eq('id', mediaId)
    .maybeSingle();
  if (error) throw error;
  if (!m) throw new HttpError(404, 'not_found');

  const role = await getRole(m.album_id, user.id);
  const allowed = role === 'owner' || (role !== null && m.uploaded_by === user.id);
  if (!allowed) throw new HttpError(403, 'forbidden');

  await deleteObjects([m.object_key, m.thumb_key]);
  const { error: delErr } = await admin.from('media').delete().eq('id', m.id);
  if (delErr) throw delErr;

  return { ok: true };
}));
