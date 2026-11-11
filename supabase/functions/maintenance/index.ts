// Chamada pelo GitHub Actions de 3 em 3 dias (header x-maintenance-secret).
//  1. Mantém o projeto Supabase ativo (faz queries reais à BD).
//  2. Limpa uploads abandonados ('pending' há mais de 1 hora) e os ficheiros no R2.
import { handler, HttpError } from '../_shared/http.ts';
import { admin } from '../_shared/supabase.ts';
import { deleteObjects } from '../_shared/r2.ts';

const SECRET = Deno.env.get('MAINTENANCE_SECRET');

Deno.serve(handler(async (req) => {
  if (!SECRET || req.headers.get('x-maintenance-secret') !== SECRET) {
    throw new HttpError(401, 'unauthorized');
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await admin
    .from('media')
    .select('id, object_key, thumb_key')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(500);
  if (error) throw error;

  if (stale?.length) {
    await deleteObjects(stale.flatMap((m) => [m.object_key, m.thumb_key]));
    const { error: delErr } = await admin.from('media').delete().in('id', stale.map((m) => m.id));
    if (delErr) throw delErr;
  }

  const { count } = await admin.from('albums').select('id', { count: 'exact', head: true });

  return { ok: true, cleaned_pending: stale?.length ?? 0, albums: count ?? 0, at: new Date().toISOString() };
}));
