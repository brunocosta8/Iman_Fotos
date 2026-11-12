-- =============================================================================
-- Ímanes de Viagem — ordem personalizada das fotos
--
-- Por defeito as fotos seguem a data em que foram tiradas. O criador do álbum
-- pode arrastá-las para outra ordem (custom_order = true); fotos novas ficam
-- no fim. "Repor por data" volta à ordem por data.
-- =============================================================================

alter table public.albums add column if not exists custom_order boolean not null default false;
alter table public.media  add column if not exists sort_index int;

-- Guarda a nova ordem (lista de ids pela ordem desejada). Só o owner.
create or replace function public.reorder_media(p_album_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_album_owner(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.media m
  set sort_index = (t.ord - 1)::int
  from unnest(p_ids) with ordinality as t(id, ord)
  where m.id = t.id and m.album_id = p_album_id;
  update public.albums set custom_order = true where id = p_album_id;
end;
$$;

-- Volta à ordem por data. Só o owner.
create or replace function public.reset_media_order(p_album_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_album_owner(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.albums set custom_order = false where id = p_album_id;
  update public.media set sort_index = null where album_id = p_album_id;
end;
$$;

grant execute on function public.reorder_media(uuid, uuid[]) to authenticated;
grant execute on function public.reset_media_order(uuid) to authenticated;

-- Vista pública: respeita a ordem personalizada quando existe.
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
        order by
          case when a.custom_order then m.sort_index end nulls last,
          m.taken_at nulls last,
          m.created_at)
      from public.media m
      where m.album_id = a.id and m.status = 'ready'
    ), '[]'::json)
  )
  from public.albums a
  where p_slug ~ '^[A-Za-z0-9]{16}$'
    and a.slug = p_slug;
$$;
