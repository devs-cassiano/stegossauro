import { authTag } from '../security/veil';
import { KEY_BYTE_LENGTH } from '../types';

const HEX = '0123456789abcdef';

export function generateKeyBytes(): Uint8Array {
  const bytes = new Uint8Array(KEY_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function formatKeyHex(keyBytes: Uint8Array): string {
  if (keyBytes.length !== KEY_BYTE_LENGTH) {
    throw new Error(`Chave deve ter exatamente ${KEY_BYTE_LENGTH} bytes`);
  }
  const parts: string[] = [];
  for (let i = 0; i < keyBytes.length; i += 2) {
    const a = keyBytes[i]!;
    const b = keyBytes[i + 1]!;
    parts.push(
      `${HEX[(a >>> 4) & 0xf]}${HEX[a & 0xf]}${HEX[(b >>> 4) & 0xf]}${HEX[b & 0xf]}`,
    );
  }
  return parts.join('-');
}

export function parseKeyHex(input: string): Uint8Array {
  const cleaned = input.trim().replace(/[\s:\-_]/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleaned)) {
    throw new Error('Formato de chave inválido: use hexadecimal');
  }
  if (cleaned.length !== KEY_BYTE_LENGTH * 2) {
    throw new Error(
      `Chave truncada ou incompleta: esperado ${KEY_BYTE_LENGTH * 2} dígitos hex, recebido ${cleaned.length}`,
    );
  }
  const out = new Uint8Array(KEY_BYTE_LENGTH);
  for (let i = 0; i < KEY_BYTE_LENGTH; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function deriveSeed(keyBytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(keyBytes));
  return new Uint8Array(digest);
}

export async function computeAuthChecksum(keyBytes: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const tag = authTag();
  const msg = new TextEncoder().encode(tag);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));
  return sig.slice(0, 4);
}

export function checksumEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function keyEntropyBits(keyBytes: Uint8Array): number {
  return keyBytes.length * 8;
}
