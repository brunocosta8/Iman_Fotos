// Acesso ao Cloudflare R2 pela API compatível com S3.
// As chaves só existem aqui (segredos da Edge Function), nunca no frontend.
import { AwsClient, AwsV4Signer } from 'npm:aws4fetch@1.0.20';

const creds = {
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  service: 's3',
  region: 'auto',
};
const endpoint =
  `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${Deno.env.get('R2_BUCKET')}`;

const client = new AwsClient(creds);

function objectUrl(key: string): string {
  return `${endpoint}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Os ficheiros nunca mudam (chave única por upload) → cache longa no browser. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

/**
 * URL PUT pré-assinado. Content-Type, Content-Length e Cache-Control fazem parte
 * da assinatura: o R2 rejeita um ficheiro com tamanho diferente do declarado.
 */
export async function presignPut(
  key: string,
  contentType: string,
  contentLength: number,
  expiresSeconds = 900,
): Promise<PresignedPut> {
  const url = new URL(objectUrl(key));
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
  const headers = {
    'content-type': contentType,
    'content-length': String(contentLength),
    'cache-control': CACHE_CONTROL,
  };
  const signer = new AwsV4Signer({
    ...creds,
    url: url.toString(),
    method: 'PUT',
    headers,
    signQuery: true,
    allHeaders: true,
  });
  const signed = await signer.sign();
  // O browser define o Content-Length sozinho (não se pode definir à mão).
  return {
    url: signed.url.toString(),
    headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
  };
}

/** Tamanho do objeto em bytes, ou null se não existir. */
export async function headObject(key: string): Promise<number | null> {
  const res = await client.fetch(objectUrl(key), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${key}: ${res.status}`);
  return Number(res.headers.get('content-length') ?? 0);
}

export async function deleteObject(key: string): Promise<void> {
  const res = await client.fetch(objectUrl(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key}: ${res.status}`);
}

/** Apaga várias chaves, até 8 em paralelo. */
export async function deleteObjects(keys: (string | null | undefined)[]): Promise<void> {
  const queue = keys.filter((k): k is string => !!k);
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) await deleteObject(queue.pop()!);
  });
  await Promise.all(workers);
}
