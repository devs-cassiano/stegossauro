/**
 * Selective in-memory compression (deflate-raw).
 * Keep compressed form only when size drops below 98% of original.
 */

export interface CompressResult {
  bytes: Uint8Array;
  compressed: boolean;
  ratio: number;
}

const COMPRESSION_KEEP_THRESHOLD = 0.98;

/** Magic / extension heuristics for formats that rarely benefit from another deflate pass. */
function looksAlreadyCompressed(data: Uint8Array, fileName: string): boolean {
  const lower = fileName.toLowerCase();

  if (data.length >= 3) {
    // JPEG
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true;
    // PNG
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e) return true;
    // ZIP / DOCX / XLSX / JAR (already deflated members)
    if (
      data[0] === 0x50 &&
      data[1] === 0x4b &&
      (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)
    ) {
      return true;
    }
    // GZIP
    if (data[0] === 0x1f && data[1] === 0x8b) return true;
    // 7z
    if (data[0] === 0x37 && data[1] === 0x7a && data[2] === 0xbc) return true;
    // RAR
    if (data[0] === 0x52 && data[1] === 0x61 && data[2] === 0x72) return true;
    // WebP
    if (
      data.length >= 12 &&
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    ) {
      return true;
    }
    // MP4 / ISO-BMFF (ftyp at offset 4)
    if (
      data.length >= 8 &&
      data[4] === 0x66 &&
      data[5] === 0x74 &&
      data[6] === 0x79 &&
      data[7] === 0x70
    ) {
      return true;
    }
    // Matroska / WebM EBML
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
      return true;
    }
    // Ogg
    if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
      return true;
    }
    // FLAC
    if (data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) {
      return true;
    }
    // ID3 / MP3
    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return true;
    if (data[0] === 0xff && data.length > 1 && (data[1]! & 0xe0) === 0xe0) return true;
  }

  return /\.(mp4|mkv|avi|mov|webm|m4v|jpg|jpeg|jpe|png|webp|gif|zip|7z|rar|gz|tgz|bz2|xz|zst|mp3|aac|opus|ogg|flac|m4a)$/i.test(
    lower,
  );
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return data;
  }
  const stream = new Blob([toArrayBuffer(data)]).stream();
  const compressed = stream.pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(compressed).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream indisponível neste ambiente');
  }
  const stream = new Blob([toArrayBuffer(data)]).stream();
  const raw = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(raw).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Try deflate-raw; keep only if compressed size < 98% of original.
 * PDF / text / source are attempted; media & archives are skipped by heuristic.
 */
export async function maybeCompress(
  data: Uint8Array,
  fileName: string,
): Promise<CompressResult> {
  if (data.length === 0) {
    return { bytes: data, compressed: false, ratio: 1 };
  }
  if (looksAlreadyCompressed(data, fileName)) {
    return { bytes: data, compressed: false, ratio: 1 };
  }

  try {
    const out = await deflateRaw(data);
    const ratio = out.length / data.length;
    if (ratio < COMPRESSION_KEEP_THRESHOLD && out.length < data.length) {
      return { bytes: out, compressed: true, ratio };
    }
    return { bytes: data, compressed: false, ratio: 1 };
  } catch {
    return { bytes: data, compressed: false, ratio: 1 };
  }
}

export async function maybeDecompress(
  data: Uint8Array,
  compressed: boolean,
): Promise<Uint8Array> {
  if (!compressed) return data;
  return inflateRaw(data);
}
