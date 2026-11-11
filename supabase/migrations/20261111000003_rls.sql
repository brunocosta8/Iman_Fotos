-- =============================================================================
-- Ímanes de Viagem — permissões e RLS
--
-- Princípios:
--  * anon não lê nenhuma tabela; só pode chamar get_public_album / get_invite_info.
--  * media é só de leitura para o cliente: inserir/apagar passa pelas Edge
--    Functions (para a BD e o R2 nunca ficarem dessincronizados).
--  * Apagar um álbum também passa pela Edge Function delete-album.
-- =============================================================================

alter table public.profiles      enable row level security;
alter table public.albums        enable row level security;
alter table public.album_members enable row level security;
alter table public.album_invites enable row level security;
alter table public.media         enable row level security;

-- Tirar os privilégios por omissão do Supabase e dar só o necessário
revoke all on public.profiles, public.albums, public.album_members,
              public.album_invites, public.media
  from anon, authenticated;

grant select on public.profiles to authenticated;

grant select on public.albums to authenticated;
grant insert (name, location, start_date, end_date) on public.albums to authenticated;
grant update (name, location, start_date, end_date, cover_media_id) on public.albums to authenticated;

grant select, delete on public.album_members to authenticated;

grant select on public.album_invites to authenticated;
grant insert (album_id, expires_at, max_uses) on public.album_invites to authenticated;
grant update (revoked_at) on public.album_invites to authenticated;

grant select on public.media to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: o próprio e quem partilha algum álbum comigo
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_album_with(id));

-- ---------------------------------------------------------------------------
-- albums
-- ---------------------------------------------------------------------------
create policy albums_select on public.albums
  for select to authenticated
  using (public.is_album_member(id) or created_by = (select auth.uid()));

create policy albums_insert on public.albums
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy albums_update on public.albums
  for update to authenticated
  using (public.is_album_owner(id))
  with check (public.is_album_owner(id));

-- ---------------------------------------------------------------------------
-- album_members: membros veem-se uns aos outros.
-- O owner remove outros; qualquer editor pode sair. O owner não sai.
-- (Entrar só via trigger de criação ou accept_invite.)
-- ---------------------------------------------------------------------------
create policy album_members_select on public.album_members
  for select to authenticated
  using (public.is_album_member(album_id));

create policy album_members_delete on public.album_members
  for delete to authenticated
  using (
    (public.is_album_owner(album_id) and user_id <> (select auth.uid()))
    or (user_id = (select auth.uid()) and role <> 'owner')
  );

-- ---------------------------------------------------------------------------
-- album_invites: membros criam e veem; quem criou ou o owner revoga
-- ---------------------------------------------------------------------------
create policy album_invites_select on public.album_invites
  for select to authenticated
  using (public.is_album_member(album_id));

create policy album_invites_insert on public.album_invites
  for insert to authenticated
  with check (public.is_album_member(album_id) and created_by = (select auth.uid()));

create policy album_invites_update on public.album_invites
  for update to authenticated
  using (public.is_album_member(album_id)
         and (created_by = (select auth.uid()) or public.is_album_owner(album_id)))
  with check (public.is_album_member(album_id));

-- ---------------------------------------------------------------------------
-- media: só leitura para membros
-- ---------------------------------------------------------------------------
create policy media_select on public.media
  for select to authenticated
  using (public.is_album_member(album_id));

-- =============================================================================
-- Funções: por omissão o Postgres/Supabase dá EXECUTE a todos. Fechar tudo e
-- abrir só o que é preciso.
-- =============================================================================
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_public_album(text) to anon, authenticated;
grant execute on function public.get_invite_info(text)  to anon, authenticated;

grant execute on function public.gen_slug(int)             to authenticated; -- defaults das colunas
grant execute on function public.is_album_member(uuid)     to authenticated;
grant execute on function public.is_album_owner(uuid)      to authenticated;
grant execute on function public.is_any_owner()            to authenticated;
grant execute on function public.shares_album_with(uuid)   to authenticated;
grant execute on function public.accept_invite(text)       to authenticated;
grant execute on function public.storage_usage()          to authenticated;
grant execute on function public.regenerate_slug(uuid)     to authenticated;

grant execute on function public.reserve_media(
  uuid, uuid, text, text, text, text, bigint, int, int, numeric, timestamptz, bigint
) to service_role;

-- Funções futuras criadas pelo postgres também não devem ficar abertas
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
