import { supabase } from './supabase.js';

const MESSAGES = {
  not_authenticated: 'Tens de iniciar sessão.',
  not_a_member: 'Não és membro deste álbum.',
  forbidden: 'Não tens permissão para fazer isso.',
  not_found: 'Não encontrado.',
  bad_request: 'Pedido inválido.',
  unsupported_type: 'Formato de ficheiro não suportado.',
  file_too_large: 'Ficheiro demasiado grande.',
  video_too_large: 'O vídeo tem mais de 30 MB e não foi possível reduzi-lo neste telemóvel.',
  video_too_long: 'O vídeo tem mais de 30 segundos.',
  video_unreadable: 'Não foi possível ler este vídeo.',
  image_decode: 'Não foi possível abrir esta imagem neste browser.',
  quota_exceeded: 'Espaço esgotado: foi atingido o limite de 9,5 GB.',
  upload_failed: 'O envio falhou. Tenta outra vez.',
  upload_missing: 'O envio não chegou ao servidor. Tenta outra vez.',
  size_mismatch: 'O ficheiro chegou com um tamanho inesperado.',
  cancelled: 'Cancelado.',
  network: 'Sem ligação à internet.',
  invite_not_found: 'Este convite não existe.',
  invite_revoked: 'Este convite foi cancelado.',
  invite_expired: 'Este convite expirou. Pede um novo.',
  invite_used_up: 'Este convite já foi usado o número máximo de vezes.',
  invalid_cover: 'A capa tem de ser uma foto deste álbum.',
  internal_error: 'Ocorreu um erro. Tenta outra vez.',
};

export class AppError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.internal_error);
    this.code = code;
  }
}

/** Mensagem em português para qualquer erro (AppError, Supabase, rede…). */
export function errorMessage(err) {
  if (!err) return MESSAGES.internal_error;
  if (err instanceof AppError) return err.message;
  const raw = String(err.message || err);
  for (const code of Object.keys(MESSAGES)) if (raw.includes(code)) return MESSAGES[code];
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return MESSAGES.network;
  return MESSAGES.internal_error;
}

/** Chama uma Edge Function e converte erros em AppError. */
export async function callFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let code = 'internal_error';
    try {
      const j = await error.context.json();
      if (j?.error) code = j.error;
    } catch {
      if (error.name === 'FunctionsFetchError') code = 'network';
    }
    throw new AppError(code);
  }
  return data;
}
