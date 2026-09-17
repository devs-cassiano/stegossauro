import {
  AUTH_CHECKSUM_SIZE,
  CHANNELS_PER_PIXEL,
  FLAG_COMPRESSED,
  FLAG_DENSITY_SHIFT,
  FLAGS_SIZE,
  META_LENGTH_SIZE,
  PAYLOAD_LENGTH_SIZE,
  type CoverImageInfo,
  type LsbDensity,
} from '../types';

/** Worker-safe: no DOM / window. */

export function capacityBitsAt(width: number, height: number, density: LsbDensity): number {
  return width * height * CHANNELS_PER_PIXEL * density;
}

export function capacityBytesAt(width: number, height: number, density: LsbDensity): number {
  return Math.floor(capacityBitsAt(width, height, density) / 8);
}

export function computeCapacity(width: number, height: number): CoverImageInfo {
  const mp = (width * height) / 1_000_000;
  return {
    width,
    height,
    megapixels: mp,
    capacityBits1: capacityBitsAt(width, height, 1),
    capacityBits2: capacityBitsAt(width, height, 2),
    capacityBits3: capacityBitsAt(width, height, 3),
    capacityBytes1: capacityBytesAt(width, height, 1),
    capacityBytes2: capacityBytesAt(width, height, 2),
    capacityBytes3: capacityBytesAt(width, height, 3),
  };
}

export function containerByteLength(metaJsonBytes: number, payloadBytes: number): number {
  return (
    AUTH_CHECKSUM_SIZE +
    FLAGS_SIZE +
    META_LENGTH_SIZE +
    metaJsonBytes +
    PAYLOAD_LENGTH_SIZE +
    payloadBytes
  );
}

export function encodeFlags(compressed: boolean, density: LsbDensity): number {
  return (compressed ? FLAG_COMPRESSED : 0) | ((density & 0b11) << FLAG_DENSITY_SHIFT);
}

export function decodeFlags(flags: number): { compressed: boolean; density: LsbDensity } {
  const compressed = (flags & FLAG_COMPRESSED) !== 0;
  const density = ((flags >> FLAG_DENSITY_SHIFT) & 0b11) as number;
  if (density !== 1 && density !== 2 && density !== 3) {
    throw new Error('Flags de densidade inválidas');
  }
  return { compressed, density };
}

export function selectDensity(
  width: number,
  height: number,
  containerBytes: number,
): LsbDensity | null {
  const bitsNeeded = containerBytes * 8;
  for (const d of [1, 2, 3] as const) {
    if (bitsNeeded <= capacityBitsAt(width, height, d)) return d;
  }
  return null;
}

export function slotsNeededForBytes(byteCount: number, density: LsbDensity): number {
  return Math.ceil((byteCount * 8) / density);
}

export function capacityExceededMessage(neededBytes: number, maxBytes3: number): string {
  return (
    `Capacidade insuficiente: o arquivo selecionado requer ${formatBytes(neededBytes)}, ` +
    `mas o disfarce comporta até ${formatBytes(maxBytes3)} em 3-LSB. ` +
    `Escolha uma imagem de maior resolução (ex.: foto de 48MP, wallpaper 4K/8K ou panorama).`
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function preserveFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'document.bin';
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'document.bin';
}

export function sanitizeFileName(name: string): string {
  return preserveFileName(name);
}
