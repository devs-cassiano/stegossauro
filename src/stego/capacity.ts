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

/**
 * Theoretical LSB capacity in bits.
 * 3-LSB: width × height × 3 RGB channels × 3 bits/channel
 * (Full HD 1920×1080 → 23_328_000 bits → 2_332_800 B ≈ 2.33 MB)
 */
export function capacityBitsAt(width: number, height: number, density: LsbDensity): number {
  if (width < 1 || height < 1) return 0;
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

/** Human size for capacity UX (SI units so FHD 3-LSB ≈ 2.33 MB). */
export function formatCapacitySize(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb >= 0.01) return `${mb.toFixed(2)} MB`;
  const kb = bytes / 1_000;
  if (kb >= 0.01) return `${kb.toFixed(2)} KB`;
  return `${Math.max(0, Math.floor(bytes))} B`;
}

/**
 * Minimum WxH (preserving aspect) whose 3-LSB capacity holds `neededContainerBytes`.
 */
export function suggestMinResolution(
  neededContainerBytes: number,
  aspectW: number,
  aspectH: number,
): { width: number; height: number } {
  const aw = aspectW > 0 ? aspectW : 16;
  const ah = aspectH > 0 ? aspectH : 9;
  const minPixels = Math.ceil((neededContainerBytes * 8) / (CHANNELS_PER_PIXEL * 3));
  const aspect = aw / ah;
  let height = Math.max(1, Math.ceil(Math.sqrt(minPixels / aspect)));
  let width = Math.max(1, Math.ceil(height * aspect));

  // Round up until 3-LSB capacity is strictly enough (ceil/floor edge cases).
  let guard = 0;
  while (capacityBytesAt(width, height, 3) < neededContainerBytes && guard < 1_000_000) {
    height += 1;
    width = Math.max(1, Math.ceil(height * aspect));
    guard += 1;
  }
  return { width, height };
}

export function capacityExceededMessage(
  neededBytes: number,
  maxBytes3: number,
  coverWidth = 0,
  coverHeight = 0,
): string {
  const aspectW = coverWidth > 0 ? coverWidth : 16;
  const aspectH = coverHeight > 0 ? coverHeight : 9;
  const { width, height } = suggestMinResolution(neededBytes, aspectW, aspectH);
  return (
    `Capacidade insuficiente em 3-LSB: Imagem suporta até ${formatCapacitySize(maxBytes3)} ` +
    `| Arquivo requer ${formatCapacitySize(neededBytes)}. ` +
    `Use uma imagem com resolução mínima sugerida de ${width} x ${height} px.`
  );
}

export function preserveFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'document.bin';
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'document.bin';
}

export function sanitizeFileName(name: string): string {
  return preserveFileName(name);
}
