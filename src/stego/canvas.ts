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

export interface SanitizedImage {
  width: number;
  height: number;
  /** RGBA buffer; every alpha channel forced to 255. */
  imageData: Uint8ClampedArray;
}

/**
 * Decode cover image → 1:1 canvas redraw → raw pixels.
 * Canvas round-trip strips EXIF, GPS, XMP, IPTC, ICC and vendor chunks.
 */
export async function purgeCoverImage(file: File | Blob): Promise<SanitizedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (width < 1 || height < 1) {
      throw new Error('Imagem de disfarce inválida (dimensões zero)');
    }

    let imageData: ImageData;

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
      if (!ctx) throw new Error('OffscreenCanvas 2D indisponível');
      ctx.drawImage(bitmap, 0, 0, width, height);
      imageData = ctx.getImageData(0, 0, width, height);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D indisponível');
      ctx.drawImage(bitmap, 0, 0, width, height);
      imageData = ctx.getImageData(0, 0, width, height);
    }

    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255;
    }

    return {
      width,
      height,
      imageData: new Uint8ClampedArray(data),
    };
  } finally {
    bitmap.close();
  }
}

export function capacityBitsAt(width: number, height: number, density: LsbDensity): number {
  return width * height * CHANNELS_PER_PIXEL * density;
}

export function capacityBytesAt(width: number, height: number, density: LsbDensity): number {
  return Math.floor(capacityBitsAt(width, height, density) / 8);
}

/** Capacities at 1/2/3-LSB for UI and planning. */
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

/**
 * Layout: auth(4) + flags(1) + metaLen(2) + meta(N) + payloadLen(4) + payload(M)
 */
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

/** Pick the lowest density that fits `containerBytes`. */
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

export function capacityExceededMessage(
  neededBytes: number,
  maxBytes3: number,
): string {
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

/**
 * Export sanitized RGBA buffer as lossless PNG Blob.
 */
export async function exportPngBlob(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const clamped = new Uint8ClampedArray(imageData.length);
  clamped.set(imageData);
  for (let i = 3; i < clamped.length; i += 4) {
    clamped[i] = 255;
  }

  const img = new ImageData(clamped, width, height);

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D indisponível');
    ctx.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  ctx.putImageData(img, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao exportar PNG'));
      },
      'image/png',
    );
  });
}

/**
 * Preserve original basename + extension; strip path and control/illegal chars only.
 */
export function preserveFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'document.bin';
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'document.bin';
}

/** @deprecated alias — prefer preserveFileName for secrets */
export function sanitizeFileName(name: string): string {
  return preserveFileName(name);
}
