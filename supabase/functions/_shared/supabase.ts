// Cliente Supabase com service_role (ignora RLS — usar só depois de validar).
import { createClient, type User } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

export const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Valida o JWT do utilizador (header Authorization) e devolve o utilizador. */
export async function requireUser(req: Request): Promise<User> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'not_authenticated');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'not_authenticated');
  return data.user;
}

/** Papel do utilizador no álbum ('owner' | 'editor') ou null se não for membro. */
export async function getRole(albumId: string, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('album_members')
    .select('role')
    .eq('album_id', albumId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role ?? null;
}
