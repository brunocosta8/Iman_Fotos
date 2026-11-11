import { googleButton, topBar } from '../components/layout.js';
import { toast } from '../components/toast.js';
import { errorMessage } from '../lib/api.js';
import { h, spinner } from '../lib/dom.js';
import { navigate, url } from '../lib/router.js';
import { getSession, supabase } from '../lib/supabase.js';

const STATUS_TEXT = {
  revoked: 'Este convite foi cancelado.',
  expired: 'Este convite expirou. Pede um novo a quem to enviou.',
  used_up: 'Este convite já foi usado o número máximo de vezes.',
};

export default async function invite(view, token) {
  const session = await getSession();
  const main = h('main', { class: 'container center narrow' }, spinner());
  view.append(topBar(session), main);

  const { data: info, error } = await supabase.rpc('get_invite_info', { p_token: token });
  if (error) {
    main.replaceChildren(h('p', { class: 'error' }, errorMessage(error)));
    return;
  }
  if (!info) {
    main.replaceChildren(h('h1', {}, 'Convite inválido'), h('p', { class: 'muted' }, 'Este link de convite não existe.'));
    return;
  }
  if (info.already_member && info.album_id) {
    navigate(`album/${info.album_id}`, { replace: true });
    return;
  }

  const title = h('h1', {}, 'Foste convidado para o álbum ', h('span', { class: 'accent' }, `«${info.album_name}»`));

  if (info.status !== 'valid') {
    main.replaceChildren(title, h('p', { class: 'muted' }, STATUS_TEXT[info.status]));
    return;
  }

  if (!session) {
    main.replaceChildren(
      title,
      h('p', { class: 'muted' }, 'Entra com a tua conta Google para te juntares e poderes adicionar fotos e vídeos.'),
      googleButton('Entrar com Google e aceitar'));
    return;
  }

  const accept = h('button', {
    class: 'btn btn--primary btn--large',
    type: 'button',
    onclick: async () => {
      accept.disabled = true;
      const { data: albumId, error: err } = await supabase.rpc('accept_invite', { p_token: token });
      if (err) {
        accept.disabled = false;
        toast(errorMessage(err), { type: 'error' });
        return;
      }
      toast('Bem-vindo ao álbum!', { type: 'success' });
      navigate(`album/${albumId}`, { replace: true });
    },
  }, 'Aceitar convite');

  main.replaceChildren(
    title,
    h('p', { class: 'muted' }, 'Ao aceitar, passas a ver o álbum na tua página inicial e podes adicionar fotos e vídeos.'),
    accept,
    h('a', { class: 'btn btn--ghost', href: url(''), 'data-link': true }, 'Agora não'));
}
