import { loginRequired, topBar } from '../components/layout.js';
import { toast } from '../components/toast.js';
import { errorMessage } from '../lib/api.js';
import { h, icon } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { getSession, supabase } from '../lib/supabase.js';

export default async function newAlbum(view) {
  const session = await getSession();
  if (!session) return loginRequired(view);

  const status = h('p', { class: 'muted small', role: 'status' });
  const form = albumForm({ submitLabel: 'Criar álbum', withCover: true });

  form.el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = form.values();
    if (!values) return;
    form.setBusy(true);
    try {
      const { data: album, error } = await supabase
        .from('albums')
        .insert(values.fields)
        .select('id')
        .single();
      if (error) throw error;

      if (values.coverFile) {
        status.textContent = 'A carregar a foto de capa…';
        const { uploadFile } = await import('../lib/upload.js');
        try {
          // A primeira foto de um álbum sem capa passa automaticamente a ser a capa.
          await uploadFile(album.id, values.coverFile);
        } catch (err) {
          toast(`Álbum criado, mas a capa falhou: ${errorMessage(err)}`, { type: 'error', ms: 5000 });
        }
      }
      navigate(`album/${album.id}`, { replace: true });
    } catch (err) {
      form.setBusy(false);
      status.textContent = '';
      toast(errorMessage(err), { type: 'error' });
    }
  });

  view.append(
    topBar(session, { back: { path: '', label: 'Álbuns' } }),
    h('main', { class: 'container narrow' },
      h('h1', { class: 'large-title' }, 'Novo álbum'),
      form.el,
      status));
}

/**
 * Formulário partilhado entre "novo álbum" e "editar álbum".
 * @returns {{ el: HTMLFormElement, values: () => ({fields, coverFile}|null), setBusy: (b) => void }}
 */
export function albumForm({ album = {}, submitLabel, withCover = false, onCancel = null }) {
  const name = h('input', { name: 'name', required: true, maxLength: 120, value: album.name || '', autocomplete: 'off', placeholder: 'Ex.: Açores 2025' });
  const location = h('input', { name: 'location', maxLength: 120, value: album.location || '', autocomplete: 'off', placeholder: 'Ex.: São Miguel, Portugal' });
  const start = h('input', { name: 'start_date', type: 'date', value: album.start_date || '' });
  const end = h('input', { name: 'end_date', type: 'date', value: album.end_date || '' });
  const cover = withCover ? h('input', { name: 'cover', type: 'file', accept: 'image/*' }) : null;
  const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, submitLabel);

  start.addEventListener('change', () => {
    end.min = start.value;
    if (!end.value || end.value < start.value) end.value = start.value;
  });
  end.min = start.value;

  const el = h('form', { class: 'form', novalidate: true },
    field('Nome', name),
    field('Local', location),
    h('div', { class: 'form__row' }, field('Início', start), field('Fim', end)),
    cover && field('Foto de capa (opcional)', cover, 'Também podes escolher a capa mais tarde, entre as fotos do álbum.'),
    h('div', { class: 'form__actions' },
      onCancel && h('button', { class: 'btn btn--ghost', type: 'button', onclick: onCancel }, 'Cancelar'),
      submit));

  return {
    el,
    values() {
      const n = name.value.trim();
      if (!n) {
        name.focus();
        toast('Dá um nome ao álbum.', { type: 'error' });
        return null;
      }
      if (start.value && end.value && end.value < start.value) {
        end.focus();
        toast('A data de fim é anterior à de início.', { type: 'error' });
        return null;
      }
      return {
        fields: {
          name: n,
          location: location.value.trim() || null,
          start_date: start.value || null,
          end_date: end.value || null,
        },
        coverFile: cover?.files?.[0] || null,
      };
    },
    setBusy(busy) {
      submit.disabled = busy;
      submit.replaceChildren(busy ? 'A guardar…' : submitLabel);
    },
  };
}

function field(label, input, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field__label' }, label),
    input,
    hint && h('span', { class: 'field__hint' }, icon('image', 14), hint));
}
