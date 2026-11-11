-- =============================================================================
-- Ímanes de Viagem — tabelas
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Texto aleatório base62 (A-Z a-z 0-9) com bytes criptográficos.
-- Usa rejection sampling (só bytes < 248 = 4*62) para não haver enviesamento.
-- 16 caracteres ≈ 95 bits de entropia: impossível de adivinhar.
create or replace function public.gen_slug(len int default 16)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  buf bytea := extensions.gen_random_bytes(len * 2);
  result text := '';
  b int;
  i int := 0;
begin
  while char_length(result) < len loop
    if i >= length(buf) then
      buf := extensions.gen_random_bytes(len * 2);
      i := 0;
    end if;
    b := get_byte(buf, i);
    i := i + 1;
    if b < 248 then
      result := result || substr(alphabet, (b % 62) + 1, 1);
    end if;
  end loop;
  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfis (nome e foto do Google), para mostrar os membros de um álbum
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Álbuns
-- -----------------------------------------------------------------------------
create table public.albums (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique default public.gen_slug(16),
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  location       text check (char_length(location) <= 120),
  start_date     date,
  end_date       date,
  cover_media_id uuid,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint albums_dates_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

-- -----------------------------------------------------------------------------
-- Membros (owner = quem criou; editor = convidado, pode adicionar fotos)
-- -----------------------------------------------------------------------------
create table public.album_members (
  album_id  uuid not null references public.albums (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at timestamptz not null default now(),
  primary key (album_id, user_id)
);
create index album_members_user_idx on public.album_members (user_id);

-- -----------------------------------------------------------------------------
-- Convites (link /convite/<token>)
-- -----------------------------------------------------------------------------
create table public.album_invites (
  id          uuid primary key default gen_random_uuid(),
  album_id    uuid not null references public.albums (id) on delete cascade,
  token       text not null unique default public.gen_slug(22),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  max_uses    int check (max_uses is null or max_uses > 0),
  use_count   int not null default 0,
  revoked_at  timestamptz
);
create index album_invites_album_idx on public.album_invites (album_id);

-- -----------------------------------------------------------------------------
-- Fotos e vídeos (os ficheiros estão no R2; aqui só os metadados)
-- -----------------------------------------------------------------------------
create table public.media (
  id          uuid primary key default gen_random_uuid(),
  album_id    uuid not null references public.albums (id) on delete cascade,
  uploaded_by uuid references auth.users (id) on delete set null,
  kind        text not null check (kind in ('photo', 'video')),
  status      text not null default 'pending' check (status in ('pending', 'ready')),
  object_key  text not null unique,   -- '<album_id>/<media_id>.webp|jpg|mp4|mov'
  thumb_key   text,                   -- '<album_id>/<media_id>_t.webp|jpg' (miniatura/poster)
  mime        text not null,
  size_bytes  bigint not null check (size_bytes > 0),  -- ficheiro + miniatura
  width       int,
  height      int,
  duration_s  numeric(6, 2),
  taken_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index media_album_idx on public.media (album_id, taken_at, created_at);
create index media_pending_idx on public.media (created_at) where status = 'pending';

alter table public.albums
  add constraint albums_cover_media_id_fkey
  foreign key (cover_media_id) references public.media (id) on delete set null;

-- =============================================================================
-- Triggers
-- =============================================================================

-- updated_at automático
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger albums_set_updated_at
  before update on public.albums
  for each row execute function public.tg_set_updated_at();

-- Perfil criado/atualizado a partir dos dados do Google
create or replace function public.tg_handle_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url   = excluded.avatar_url;
  return new;
end;
$$;

create trigger on_auth_user_saved
  after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.tg_handle_user();

-- Utilizadores que já existiam antes desta migração
insert into public.profiles (id, display_name, avatar_url)
select id,
       coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1)),
       coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture')
from auth.users
on conflict (id) do nothing;

-- Quem cria o álbum fica owner
create or replace function public.tg_album_add_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.album_members (album_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger albums_add_owner
  after insert on public.albums
  for each row execute function public.tg_album_add_owner();

-- A capa tem de ser uma foto pronta do próprio álbum
create or replace function public.tg_album_check_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cover_media_id is not null and not exists (
    select 1 from public.media m
    where m.id = new.cover_media_id
      and m.album_id = new.id
      and m.kind = 'photo'
      and m.status = 'ready'
  ) then
    raise exception 'invalid_cover' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger albums_check_cover
  before update of cover_media_id on public.albums
  for each row execute function public.tg_album_check_cover();
