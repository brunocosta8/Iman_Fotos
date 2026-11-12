// Fluxo de envio de um ficheiro:
//   1. reduzir no browser (foto) / converter (vídeo)
//   2. pedir URLs pré-assinados à Edge Function upload-url
//      (verifica membro + limite de espaço)
//   3. PUT direto para o R2
//   4. confirm-upload marca o ficheiro como pronto
import { AppError, callFn } from './api.js';
import { processImage } from './image.js';

const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm)$/i;

let processingChain = Promise.resolve();
/** Executa as tarefas pela ordem de chegada, uma de cada vez. */
function oneAtATime(task) {
  const run = processingChain.then(task, task);
  processingChain = run.catch(() => {});
  return run;
}

export function detectKind(file) {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  if (PHOTO_EXT.test(file.name)) return 'photo';
  if (VIDEO_EXT.test(file.name)) return 'video';
  return null;
}

/**
 * @param {string} albumId
 * @param {File} file
 * @param {(s: {phase: 'prepare'|'convert'|'upload'|'confirm', progress?: number}) => void} onStatus
 * @returns {Promise<object>} linha de media criada
 */
export async function uploadFile(albumId, file, onStatus = () => {}) {
  const kind = detectKind(file);
  if (!kind) throw new AppError('unsupported_type');

  // Só uma foto/vídeo é reduzida de cada vez (é o que gasta memória no
  // telemóvel); os envios podem acontecer vários ao mesmo tempo.
  const p = await oneAtATime(async () => {
    onStatus({ phase: 'prepare' });
    if (kind === 'photo') return processImage(file);
    const { processVideo } = await import('./video.js'); // biblioteca pesada: só quando é preciso
    return processVideo(file, (progress) => onStatus({ phase: 'convert', progress }));
  });

  const res = await callFn('upload-url', {
    album_id: albumId,
    kind,
    mime: p.mime,
    size: p.blob.size,
    thumb_mime: p.thumb ? p.thumb.type : null,
    thumb_size: p.thumb ? p.thumb.size : 0,
    width: p.width || null,
    height: p.height || null,
    duration_s: kind === 'video' ? p.duration : null,
    taken_at: p.takenAt || null,
  });

  try {
    const total = p.blob.size + (p.thumb?.size || 0);
    const sent = [0, 0];
    const report = () => onStatus({ phase: 'upload', progress: (sent[0] + sent[1]) / total });
    report();
    await Promise.all([
      put(res.upload, p.blob, (n) => { sent[0] = n; report(); }),
      res.thumb && p.thumb ? put(res.thumb, p.thumb, (n) => { sent[1] = n; report(); }) : null,
    ]);

    onStatus({ phase: 'confirm' });
    const { media } = await callFn('confirm-upload', { media_id: res.media_id });
    return media;
  } catch (err) {
    // Liberta já o espaço reservado (senão a limpeza automática trata disso).
    callFn('delete-media', { media_id: res.media_id }).catch(() => {});
    throw err;
  }
}

function put({ url, headers }, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size);
        resolve();
      } else {
        reject(new AppError('upload_failed'));
      }
    };
    xhr.onerror = () => reject(new AppError('network'));
    xhr.send(blob);
  });
}
