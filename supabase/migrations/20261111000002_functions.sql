-- =============================================================================
-- Ímanes de Viagem — funções
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auxiliares para RLS (SECURITY DEFINER evita recursão nas políticas)
-- -----------------------------------------------------------------------------
create or replace function public.is_album_member(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.album_members
    where album_id = p_album_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_album_owner(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.album_members
    where album_id = p_album_id and user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_any_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.album_members
    where user_id = auth.uid() and role = 'owner'
  );
$$;

-- O utilizador atual partilha algum álbum com p_user_id?
create or replace function public.shares_album_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.album_members me
    join public.album_members other on other.album_id = me.album_id
    where me.user_id = auth.uid() and other.user_id = p_user_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Vista pública (sem login): devolve UM álbum pelo slug, ou null.
-- Não expõe utilizadores, convites nem outros álbuns.
-- -----------------------------------------------------------------------------
create or replace function public.get_public_album(p_slug text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'id',         a.id,
    'name',       a.name,
    'location',   a.location,
    'start_date', a.start_date,
    'end_date',   a.end_date,
    'cover', (
      select json_build_object(
        'object_key', c.object_key, 'thumb_key', c.thumb_key,
        'width', c.width, 'height', c.height)
      from public.media c
      where c.id = a.cover_media_id and c.status = 'ready'
    ),
    'media', coalesce((
      select json_agg(json_build_object(
          'id', m.id, 'kind', m.kind, 'mime', m.mime,
          'object_key', m.object_key, 'thumb_key', m.thumb_key,
          'width', m.width, 'height', m.height,
          'duration_s', m.duration_s, 'taken_at', m.taken_at)
        order by m.taken_at nulls last, m.created_at)
      from public.media m
      where m.album_id = a.id and m.status = 'ready'
    ), '[]'::json)
  )
  from public.albums a
  where p_slug ~ '^[A-Za-z0-9]{16}$'
    and a.slug = p_slug;
$$;

-- -----------------------------------------------------------------------------
-- Convites
-- -----------------------------------------------------------------------------

-- Informação mínima para a página do convite (nome do álbum + estado)
create or replace function public.get_invite_info(p_token text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'album_name', a.name,
    'status', case
      when i.revoked_at is not null then 'revoked'
      when i.expires_at < now() then 'expired'
      when i.max_uses is not null and i.use_count >= i.max_uses then 'used_up'
      else 'valid'
    end,
    'already_member', public.is_album_member(a.id),
    'album_id', case when public.is_album_member(a.id) then a.id end
  )
  from public.album_invites i
  join public.albums a on a.id = i.album_id
  where p_token ~ '^[A-Za-z0-9]{22}$'
    and i.token = p_token;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.album_invites;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_inv
  from public.album_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  -- Já é membro: não gasta usos
  if exists (select 1 from public.album_members
             where album_id = v_inv.album_id and user_id = v_uid) then
    return v_inv.album_id;
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'invite_revoked' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;
  if v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then
    raise exception 'invite_used_up' using errcode = 'P0001';
  end if;

  insert into public.album_members (album_id, user_id, role)
  values (v_inv.album_id, v_uid, 'editor');

  update public.album_invites
  set use_count = use_count + 1
  where id = v_inv.id;

  return v_inv.album_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Espaço usado (global: o limite de 10 GB é da conta R2).
-- Só os owners veem; para os outros devolve null.
-- Conta também os uploads 'pending' (espaço reservado).
-- -----------------------------------------------------------------------------
create or replace function public.storage_usage()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_any_owner()
      then (select coalesce(sum(size_bytes), 0)::bigint from public.media)
  end;
$$;

-- -----------------------------------------------------------------------------
-- Gerar novo link público (invalida as tags NFC antigas!) — só owner
-- -----------------------------------------------------------------------------
create or replace function public.regenerate_slug(p_album_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  if not public.is_album_owner(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.albums
  set slug = public.gen_slug(16)
  where id = p_album_id
  returning slug into v_slug;
  return v_slug;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reserva de espaço + criação da linha 'pending'.
-- Chamada APENAS pela Edge Function upload-url (service_role).
-- O advisory lock serializa as reservas: dois uploads em simultâneo não
-- conseguem ultrapassar o limite juntos.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_media(
  p_album_id    uuid,
  p_user_id     uuid,
  p_kind        text,
  p_mime        text,
  p_ext         text,
  p_thumb_ext   text,
  p_size_bytes  bigint,
  p_width       int,
  p_height      int,
  p_duration_s  numeric,
  p_taken_at    timestamptz,
  p_block_bytes bigint
)
returns public.media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid := gen_random_uuid();
  v_used bigint;
  v_row  public.media;
begin
  perform pg_advisory_xact_lock(hashtext('imanes_media_quota'));

  select coalesce(sum(size_bytes), 0) into v_used from public.media;
  if v_used + p_size_bytes > p_block_bytes then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  insert into public.media (
    id, album_id, uploaded_by, kind, status, object_key, thumb_key, mime,
    size_bytes, width, height, duration_s, taken_at)
  values (
    v_id, p_album_id, p_user_id, p_kind, 'pending',
    p_album_id || '/' || v_id || '.' || p_ext,
    case when p_thumb_ext is not null then p_album_id || '/' || v_id || '_t.' || p_thumb_ext end,
    p_mime, p_size_bytes, p_width, p_height, p_duration_s, p_taken_at)
  returning * into v_row;

  return v_row;
end;
$$;
