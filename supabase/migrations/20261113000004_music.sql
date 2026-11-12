-- =============================================================================
-- Ímanes de Viagem — música de fundo por álbum
--
-- A música é guardada como uma linha de `media` com kind = 'audio' (no máximo
-- uma por álbum; a Edge Function confirm-upload apaga a anterior). Assim conta
-- para o espaço usado e é apagada com o álbum, como as fotos.
-- =============================================================================

alter table public.media drop constraint if exists media_kind_check;
alter table public.media
  add constraint media_kind_check check (kind in ('photo', 'video', 'audio'));

-- Nome da música (nome do ficheiro), para mostrar na gestão
alter table public.media
  add column if not exists title text check (char_length(title) <= 200);

-- Vista pública: a grelha só tem fotos e vídeos; a música vem à parte.
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
    'music', (
      select json_build_object('object_key', s.object_key, 'mime', s.mime, 'title', s.title)
      from public.media s
      where s.album_id = a.id and s.kind = 'audio' and s.status = 'ready'
      order by s.created_at desc
      limit 1
    ),
    'media', coalesce((
      select json_agg(json_build_object(
          'id', m.id, 'kind', m.kind, 'mime', m.mime,
          'object_key', m.object_key, 'thumb_key', m.thumb_key,
          'width', m.width, 'height', m.height,
          'duration_s', m.duration_s, 'taken_at', m.taken_at)
        order by m.taken_at nulls last, m.created_at)
      from public.media m
      where m.album_id = a.id and m.status = 'ready' and m.kind in ('photo', 'video')
    ), '[]'::json)
  )
  from public.albums a
  where p_slug ~ '^[A-Za-z0-9]{16}$'
    and a.slug = p_slug;
$$;
