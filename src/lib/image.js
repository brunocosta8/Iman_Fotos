// Redução de fotos no browser: ~1600 px, WebP (ou JPEG), ~300–500 KB,
// mais uma miniatura de ~480 px para a grelha. O canvas remove o EXIF
// (incluindo a localização GPS); a data da foto é lida antes.
import { AppError } from './api.js';
import { PHOTO_MAX_SIDE, PHOTO_TARGET_BYTES, THUMB_MAX_SIDE } from './limits.js';

const QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5];

export async function processImage(file) {
  const takenAt = await readTakenAt(file);
  const img = await loadImage(file);
  let main;
  try {
    // A foto original (até 48 MP no iPhone) só é usada uma vez e libertada logo.
    main = await encode(img, img.naturalWidth, img.naturalHeight, PHOTO_MAX_SIDE, QUALITIES, PHOTO_TARGET_BYTES, { keepCanvas: true });
  } finally {
    URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
  }
  try {
    // Miniatura a partir da versão já reduzida (muito menos memória).
    const thumb = await encode(main.canvas, main.width, main.height, THUMB_MAX_SIDE, [0.72], Infinity);
    return {
      blob: main.blob,
      mime: main.blob.type,
      width: main.width,
      height: main.height,
      thumb: thumb.blob,
      takenAt,
    };
  } finally {
    main.canvas.width = main.canvas.height = 0;
  }
}

async function readTakenAt(file) {
  try {
    const { default: exifr } = await import('exifr/dist/lite.esm.mjs');
    // (a opção `pick` tem um bug na versão lite; ler só o bloco EXIF)
    const d = await exifr.parse(file, { tiff: true, exif: true, ifd0: false, gps: false, interop: false, ifd1: false });
    const v = d?.DateTimeOriginal || d?.CreateDate;
    return v instanceof Date && !isNaN(v) ? v.toISOString() : null;
  } catch {
    return null;
  }
}

async function loadImage(file) {
  const img = new Image();
  img.decoding = 'async';
  img.src = URL.createObjectURL(file);
  try {
    await img.decode(); // aplica a orientação EXIF automaticamente
    return img;
  } catch {
    URL.revokeObjectURL(img.src);
    throw new AppError('image_decode');
  }
}

export function fitSize(w, h, maxSide) {
  const r = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(1, Math.round(w * r)), Math.max(1, Math.round(h * r))];
}

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

let webpSupport;
/** WebP se o browser o souber codificar (o Safari antigo devolve PNG). */
async function outputType() {
  if (webpSupport === undefined) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const b = await toBlob(c, 'image/webp', 0.8);
    webpSupport = b?.type === 'image/webp';
  }
  return webpSupport ? 'image/webp' : 'image/jpeg';
}

/** Desenha uma fonte (img, video…) num canvas reduzido e codifica. */
export async function encode(source, w0, h0, maxSide, qualities, targetBytes, { keepCanvas = false } = {}) {
  const [w, h] = fitSize(w0, h0, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  const type = await outputType();
  let blob = null;
  for (const q of qualities) {
    blob = await toBlob(canvas, type, q);
    if (!blob) throw new AppError('image_decode');
    if (blob.size <= targetBytes) break;
  }
  if (keepCanvas) return { blob, width: w, height: h, canvas };
  canvas.width = canvas.height = 0; // liberta memória (importante no iPhone)
  return { blob, width: w, height: h };
}
