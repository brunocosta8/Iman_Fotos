-- =============================================================================
-- Ímanes de Viagem — coordenadas do local de cada álbum (para o mapa)
-- Preenchidas quando se escolhe uma cidade da lista de sugestões.
-- =============================================================================

alter table public.albums add column if not exists latitude  double precision check (latitude between -90 and 90);
alter table public.albums add column if not exists longitude double precision check (longitude between -180 and 180);

grant insert (latitude, longitude) on public.albums to authenticated;
grant update (latitude, longitude) on public.albums to authenticated;
