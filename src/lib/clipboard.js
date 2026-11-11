import { toast } from '../components/toast.js';

export async function copyText(text, okMessage = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Alternativa para browsers antigos / contextos sem permissão
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) {
      window.prompt('Copia o link:', text);
      return;
    }
  }
  toast(okMessage, { type: 'success' });
}

/** Folha de partilha nativa do telemóvel; se não existir, copia. */
export async function shareOrCopy(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  await copyText(url, 'Link copiado');
}
