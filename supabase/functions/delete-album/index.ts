// POST { album_id } → apaga todos os ficheiros do álbum no R2 e depois o álbum. Só o owner.
import { handler, HttpError, readJson, requireUuid } from '../_shared/http.ts';
import { admin, getRole, requireUser } from '../_shared/supabase.ts';
import { deleteObjects } from '../_shared/r2.ts';

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const albumId = requireUuid((await readJson(req)).album_id);

  if ((await getRole(albumId, user.id)) !== 'owner') throw new HttpError(403, 'forbidden');

  const { data: media, error } = await admin
    .from('media')
    .select('object_key, thumb_key')
    .eq('album_id', albumId);
  if (error) throw error;

  await deleteObjects((media ?? []).flatMap((m) => [m.object_key, m.thumb_key]));

  const { error: delErr } = await admin.from('albums').delete().eq('id', albumId);
  if (delErr) throw delErr;

  return { ok: true, deleted_files: media?.length ?? 0 };
}));
