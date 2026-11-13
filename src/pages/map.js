// Mapa das viagens: um pin (com a foto de capa) por álbum, no local do álbum.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { mediaUrl } from '../config.js';
import { emptyState, loginRequired, topBar } from '../components/layout.js';
import { geocodePlace } from '../components/place-input.js';
import { h, icon, spinner } from '../lib/dom.js';
import { formatDateRange, plural } from '../lib/format.js';
import { navigate } from '../lib/router.js';
import { getSession, supabase } from '../lib/supabase.js';

export default async function mapPage(view) {
  const session = await getSession();
  if (!session) return loginRequired(view);

  const mapEl = h('div', { class: 'map' });
  const note = h('p', { class: 'group__footer' });
  const main = h('main', { class: 'container' },
    h('h1', { class: 'large-title' }, 'Mapa'),
    h('div', { class: 'map-wrap' }, mapEl, h('div', { class: 'map-loading' }, spinner('A carregar o mapa…'))),
    note);
  view.append(topBar(session, { back: { path: '', label: 'Álbuns' } }), main);

  const { data: albums, error } = await supabase
    .from('albums')
    .select('*, cover:media!albums_cover_media_id_fkey(object_key, thumb_key), album_members!inner(role)')
    .eq('album_members.user_id', session.user.id);
  if (error) throw error;

  const map = L.map(mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix('');
  addTiles(map);
  map.setView([39.5, -8], 5); // Portugal, enquanto os pins carregam
  main.querySelector('.map-loading')?.remove();
  setTimeout(() => map.invalidateSize(), 50);

  // Coordenadas: as guardadas no álbum ou, para álbuns antigos/texto livre,
  // procuradas pelo nome do local (e guardadas, se fores o criador).
  const placed = await Promise.all(albums.map(async (a) => {
    if (a.latitude != null && a.longitude != null) return { a, lat: a.latitude, lon: a.longitude };
    if (!a.location) return null;
    const hit = await Promise.race([
      geocodePlace(a.location).catch(() => null),
      new Promise((res) => setTimeout(() => res(null), 6000)), // não ficar à espera para sempre
    ]);
    if (!hit) return null;
    if (a.album_members?.[0]?.role === 'owner') {
      supabase.from('albums').update({ latitude: hit.latitude, longitude: hit.longitude }).eq('id', a.id).then(() => {});
    }
    return { a, lat: hit.latitude, lon: hit.longitude };
  }));
  const points = placed.filter(Boolean);

  // Álbuns no mesmo sítio: afastar ligeiramente para se verem todos
  const seen = new Map();
  for (const p of points) {
    const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n) {
      const angle = n * 2.4;
      p.lat += Math.sin(angle) * 0.02 * Math.sqrt(n);
      p.lon += Math.cos(angle) * 0.02 * Math.sqrt(n);
    }
  }

  for (const { a, lat, lon } of points) {
    const thumb = a.cover?.thumb_key || a.cover?.object_key;
    const pin = h('div', { class: 'pin' },
      thumb ? h('img', { src: mediaUrl(thumb), alt: '' }) : h('span', {}, a.name.slice(0, 1).toUpperCase()));
    const marker = L.marker([lat, lon], {
      icon: L.divIcon({ html: pin, className: 'pin-icon', iconSize: [54, 54], iconAnchor: [27, 27], popupAnchor: [0, -26] }),
      title: a.name,
      riseOnHover: true,
    }).addTo(map);
    marker.bindPopup(() => popup(a), { closeButton: false, minWidth: 220, maxWidth: 260 });
  }

  const missing = albums.length - points.length;
  if (!albums.length) {
    main.querySelector('.map-wrap').replaceWith(h('div', { class: 'card' },
      emptyState('Ainda não tens álbuns', 'Cria um álbum e escolhe o local para ele aparecer no mapa.')));
  } else {
    note.textContent = [
      plural(points.length, 'álbum no mapa', 'álbuns no mapa'),
      missing > 0 && `${plural(missing, 'álbum', 'álbuns')} sem local (escolhe o local em «Editar»)`,
    ].filter(Boolean).join(' · ');
  }

  if (points.length === 1) map.setView([points[0].lat, points[0].lon], 7);
  else if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), { padding: [48, 48], maxZoom: 9 });
  map.invalidateSize();

  return () => map.remove();
}

/**
 * Mapa base do OpenStreetMap: gratuito e sem chave.
 * (A CARTO passou a exigir chave e devolvia imagens "API key required".)
 */
function addTiles(map) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    referrerPolicy: 'strict-origin-when-cross-origin', // o OSM exige saber de que site vem o pedido
    className: 'map-tiles',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}

function popup(a) {
  const cover = a.cover?.thumb_key || a.cover?.object_key;
  const isOwner = a.album_members?.[0]?.role === 'owner';
  return h('div', { class: 'map-pop' },
    cover && h('img', { class: 'map-pop__img', src: mediaUrl(cover), alt: '' }),
    h('strong', { class: 'map-pop__title' }, a.name),
    h('span', { class: 'map-pop__meta' }, [formatDateRange(a.start_date, a.end_date), a.location].filter(Boolean).join(' · ')),
    h('div', { class: 'map-pop__btns' },
      h('button', { class: 'btn btn--primary btn--small', type: 'button', onclick: () => navigate(`a/${a.slug}?convidado`) },
        icon('eye', 15), 'Ver'),
      h('button', { class: 'btn btn--tinted btn--small', type: 'button', onclick: () => navigate(`album/${a.id}`) },
        icon(isOwner ? 'edit' : 'image', 15), isOwner ? 'Gerir' : 'Abrir')));
}
