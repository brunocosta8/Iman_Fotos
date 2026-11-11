// Vídeos: máx. 30 s. Tenta converter para H.264 720p (MP4) no próprio
// telemóvel com WebCodecs (biblioteca mediabunny). Se o browser não conseguir,
// envia o original desde que tenha até 30 MB.
import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality,
} from 'mediabunny';
import { AppError } from './api.js';
import { encode } from './image.js';
import {
  THUMB_MAX_SIDE, VIDEO_BITRATE, VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, VIDEO_MIMES, VIDEO_TARGET_SHORT_SIDE,
} from './limits.js';

/**
 * @param {File} file
 * @param {(p: number) => void} [onProgress] progresso da conversão (0–1)
 */
export async function processVideo(file, onProgress) {
  let input = null;
  let duration = null;
  let width = null;
  let height = null;

  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    duration = await input.computeDuration();
    const track = await input.getPrimaryVideoTrack();
    if (track) {
      width = track.displayWidth;
      height = track.displayHeight;
    }
  } catch (e) {
    console.warn('mediabunny não leu o vídeo', e);
    input = null;
  }

  if (!duration) {
    const meta = await readMetaWithVideoElement(file).catch(() => null);
    if (!meta) throw new AppError('video_unreadable');
    ({ duration, width, height } = meta);
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new AppError('video_unreadable');
  if (duration > VIDEO_MAX_SECONDS) throw new AppError('video_too_long');

  let converted = null;
  if (input && 'VideoEncoder' in window) {
    try {
      converted = await transcode(input, width, height, onProgress);
    } catch (e) {
      console.warn('conversão falhou', e);
    }
  }

  const originalMime = normalizeMime(file);
  const originalOk = file.size <= VIDEO_MAX_BYTES && VIDEO_MIMES.includes(originalMime);

  let blob;
  let mime;
  if (converted && converted.blob.size <= VIDEO_MAX_BYTES && (!converted.lostAudio || !originalOk)) {
    if (converted.lostAudio &&
        !confirm('Neste telemóvel não é possível manter o som deste vídeo. Enviar sem som?')) {
      throw new AppError('cancelled');
    }
    ({ blob, width, height } = converted);
    mime = 'video/mp4';
  } else if (originalOk) {
    blob = file;
    mime = originalMime;
  } else {
    throw new AppError(file.size > VIDEO_MAX_BYTES ? 'video_too_large' : 'unsupported_type');
  }

  let poster = await capturePoster(blob).catch(() => null);
  if (!poster && blob !== file) poster = await capturePoster(file).catch(() => null);

  return { blob, mime, width, height, duration, thumb: poster };
}

async function transcode(input, width, height, onProgress) {
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const video = { codec: 'avc', quality: new Quality({ bitrate: VIDEO_BITRATE }) };
  let outW = width;
  let outH = height;
  if (width && height && Math.min(width, height) > VIDEO_TARGET_SHORT_SIDE) {
    // Só se define um lado: o outro é calculado mantendo a proporção.
    if (width >= height) {
      video.height = VIDEO_TARGET_SHORT_SIDE;
      outW = Math.round((width * VIDEO_TARGET_SHORT_SIDE) / height);
      outH = VIDEO_TARGET_SHORT_SIDE;
    } else {
      video.width = VIDEO_TARGET_SHORT_SIDE;
      outW = VIDEO_TARGET_SHORT_SIDE;
      outH = Math.round((height * VIDEO_TARGET_SHORT_SIDE) / width);
    }
  }

  // Sem opções de áudio: o AAC do telemóvel é copiado sem reconversão.
  const conversion = await Conversion.init({ input, output, video, tracks: 'primary' });
  if (!conversion.isValid) return null;
  if (conversion.discardedTracks.some((d) => d.track.type === 'video')) return null;
  const lostAudio = conversion.discardedTracks.some(
    (d) => d.track.type === 'audio' && d.reason !== 'discarded_by_user',
  );

  if (onProgress) conversion.onProgress = (p) => onProgress(p);
  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) return null;
  return { blob: new Blob([buffer], { type: 'video/mp4' }), width: outW, height: outH, lostAudio };
}

function normalizeMime(file) {
  if (file.type) return file.type === 'video/x-m4v' ? 'video/mp4' : file.type;
  const ext = file.name.split('.').pop().toLowerCase();
  return { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }[ext] || '';
}

function withVideo(blob, onReady, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const src = URL.createObjectURL(blob);
    let finished = false;
    const done = (value, err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(src);
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => done(null, new Error('timeout')), timeoutMs);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => done(null, new Error('video error'));
    onReady(v, done);
    v.src = src;
  });
}

function readMetaWithVideoElement(file) {
  return withVideo(file, (v, done) => {
    v.onloadedmetadata = () =>
      done({ duration: v.duration, width: v.videoWidth || null, height: v.videoHeight || null });
  });
}

/** Imagem de pré-visualização (poster) a partir de um frame do vídeo. */
function capturePoster(blob) {
  return withVideo(blob, (v, done) => {
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = async () => {
      try {
        if (!v.videoWidth) throw new Error('sem frame');
        const { blob: img } = await encode(v, v.videoWidth, v.videoHeight, THUMB_MAX_SIDE, [0.72], Infinity);
        done(img);
      } catch (e) {
        done(null, e);
      }
    };
  });
}
