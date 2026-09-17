import { computeAuthChecksum, checksumEquals, deriveSeed } from '../crypto/keys';
import { createPcg32, slotToByteOffset, uniqueIndices } from '../crypto/prng';
import {
  AUTH_CHECKSUM_SIZE,
  CHANNELS_PER_PIXEL,
  FLAGS_SIZE,
  META_LENGTH_SIZE,
  PAYLOAD_LENGTH_SIZE,
  type EmbedRequest,
  type EmbedResult,
  type ExtractRequest,
  type ExtractResult,
  type LsbDensity,
  type SecretMetadata,
} from '../types';
import {
  capacityBitsAt,
  capacityExceededMessage,
  containerByteLength,
  decodeFlags,
  encodeFlags,
  selectDensity,
  slotsNeededForBytes,
} from './canvas';
import { maybeCompress, maybeDecompress } from './compress';

export type ProgressFn = (percent: number, message: string) => void;

function buildContainer(
  auth: Uint8Array,
  flags: number,
  metaBytes: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  if (metaBytes.length > 0xffff) {
    throw new Error('Metadados JSON excedem 65535 bytes');
  }
  if (payload.length > 0xffffffff) {
    throw new Error('Payload excede 4 GiB');
  }

  const total = containerByteLength(metaBytes.length, payload.length);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let o = 0;
  buf.set(auth, o);
  o += AUTH_CHECKSUM_SIZE;
  buf[o++] = flags & 0xff;
  view.setUint16(o, metaBytes.length, false);
  o += META_LENGTH_SIZE;
  buf.set(metaBytes, o);
  o += metaBytes.length;
  view.setUint32(o, payload.length, false);
  o += PAYLOAD_LENGTH_SIZE;
  buf.set(payload, o);

  return buf;
}

function writeMultiLsb(
  pixels: Uint8ClampedArray,
  slots: Uint32Array,
  data: Uint8Array,
  density: LsbDensity,
  onProgress?: ProgressFn,
): void {
  const mask = (1 << density) - 1;
  const totalBits = data.length * 8;
  const slotCount = slotsNeededForBytes(data.length, density);
  let bitPos = 0;

  for (let s = 0; s < slotCount; s++) {
    let chunk = 0;
    for (let i = 0; i < density; i++) {
      chunk <<= 1;
      if (bitPos < totalBits) {
        const byteI = (bitPos / 8) | 0;
        const bitInByte = 7 - (bitPos % 8);
        chunk |= (data[byteI]! >> bitInByte) & 1;
        bitPos++;
      }
    }
    const offset = slotToByteOffset(slots[s]!);
    pixels[offset] = (pixels[offset]! & ~mask) | (chunk & mask);

    if (onProgress && (s & 0x3fff) === 0) {
      onProgress(
        Math.min(99, Math.round((s / slotCount) * 100)),
        `Injetando bits (${density}-LSB) ${s}/${slotCount}`,
      );
    }
  }
  onProgress?.(100, `Bits injetados em modo ${density}-LSB`);
}

function readMultiLsb(
  pixels: Uint8ClampedArray,
  slots: Uint32Array,
  byteCount: number,
  density: LsbDensity,
  bitOffset = 0,
): Uint8Array {
  const mask = (1 << density) - 1;
  const out = new Uint8Array(byteCount);
  const totalBits = byteCount * 8;
  let bitPos = 0;
  let slotIdx = Math.floor(bitOffset / density);
  let skipBitsInSlot = bitOffset % density;

  // Advance into the starting slot if bitOffset is mid-slot
  while (bitPos < totalBits) {
    const offset = slotToByteOffset(slots[slotIdx]!);
    const chunk = pixels[offset]! & mask;
    for (let i = density - 1; i >= 0; i--) {
      if (skipBitsInSlot > 0) {
        skipBitsInSlot--;
        continue;
      }
      if (bitPos >= totalBits) break;
      const bit = (chunk >> i) & 1;
      const byteI = (bitPos / 8) | 0;
      const bitInByte = 7 - (bitPos % 8);
      out[byteI] = out[byteI]! | (bit << bitInByte);
      bitPos++;
    }
    slotIdx++;
  }
  return out;
}

async function prepareSlots(
  keyBytes: Uint8Array,
  width: number,
  height: number,
  slotCount: number,
): Promise<Uint32Array> {
  const seed = await deriveSeed(keyBytes);
  const prng = createPcg32(seed);
  const universe = width * height * CHANNELS_PER_PIXEL;
  return uniqueIndices(prng, universe, slotCount);
}

/**
 * Embed arbitrary binary secret using adaptive density + optional deflate-raw.
 */
export async function embed(
  req: EmbedRequest,
  onProgress?: ProgressFn,
): Promise<EmbedResult> {
  onProgress?.(3, 'Derivando semente SHA-256');
  const auth = await computeAuthChecksum(req.keyBytes);

  const meta: SecretMetadata = {
    name: req.metadata.name,
    mimeType: req.metadata.mimeType || 'application/octet-stream',
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));

  onProgress?.(8, 'Avaliando compressão seletiva (deflate-raw)');
  const compressed = await maybeCompress(req.secretBytes, meta.name);
  if (compressed.compressed) {
    onProgress?.(
      14,
      `Compressão ativa (−${((1 - compressed.ratio) * 100).toFixed(1)}%)`,
    );
  } else {
    onProgress?.(14, 'Compressão omitida (ganho nulo ou mídia já compactada)');
  }

  // Density is chosen then encoded in flags; build container with chosen density.
  // We need density before buildContainer for flags — select based on container size.
  // Container size depends on flags (1 byte fixed) — circular only on density value inside flags.
  // Probe: pick density for size with any flags byte, then rebuild with correct flags.

  const provisionalLen = containerByteLength(
    metaBytes.length,
    compressed.bytes.length,
  );
  const density = selectDensity(req.width, req.height, provisionalLen);
  if (!density) {
    throw new Error(
      capacityExceededMessage(
        provisionalLen,
        Math.floor(capacityBitsAt(req.width, req.height, 3) / 8),
      ),
    );
  }

  const flags = encodeFlags(compressed.compressed, density);
  const container = buildContainer(auth, flags, metaBytes, compressed.bytes);
  const bitsNeeded = container.length * 8;
  const capacityBits = capacityBitsAt(req.width, req.height, density);

  onProgress?.(18, `Densidade ${density}-LSB selecionada automaticamente`);
  onProgress?.(22, 'PRNG inicializado — permutação Fisher-Yates');

  const slotCount = slotsNeededForBytes(container.length, density);
  const slots = await prepareSlots(req.keyBytes, req.width, req.height, slotCount);

  const pixels = new Uint8ClampedArray(req.imageData);
  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = 255;
  }

  onProgress?.(28, `Injetando container oculto (${density}-LSB disperso)`);
  writeMultiLsb(pixels, slots, container, density, (p, m) => {
    onProgress?.(28 + Math.round(p * 0.65), m);
  });

  return {
    imageData: pixels,
    width: req.width,
    height: req.height,
    bitsUsed: bitsNeeded,
    capacityBits,
    occupancyRatio: bitsNeeded / capacityBits,
    density,
    compressed: compressed.compressed,
    compressionRatio: compressed.ratio,
    originalBytes: req.secretBytes.length,
    storedBytes: compressed.bytes.length,
  };
}

/**
 * Extract: probe densities 1→3 until Auth Checksum + flags density agree.
 */
export async function extract(
  req: ExtractRequest,
  onProgress?: ProgressFn,
): Promise<ExtractResult> {
  onProgress?.(5, 'Derivando semente SHA-256');
  const expectedAuth = await computeAuthChecksum(req.keyBytes);

  const probeBytes = AUTH_CHECKSUM_SIZE + FLAGS_SIZE;
  let density: LsbDensity | null = null;
  let flagsByte = 0;

  onProgress?.(12, 'Sondando densidade LSB (1→3)');
  for (const d of [1, 2, 3] as const) {
    const maxBits = capacityBitsAt(req.width, req.height, d);
    if (probeBytes * 8 > maxBits) continue;

    const slots = await prepareSlots(
      req.keyBytes,
      req.width,
      req.height,
      slotsNeededForBytes(probeBytes, d),
    );
    const probe = readMultiLsb(req.imageData, slots, probeBytes, d);
    const auth = probe.slice(0, AUTH_CHECKSUM_SIZE);
    if (!checksumEquals(auth, expectedAuth)) continue;

    try {
      const decoded = decodeFlags(probe[AUTH_CHECKSUM_SIZE]!);
      if (decoded.density !== d) continue;
      density = d;
      flagsByte = probe[AUTH_CHECKSUM_SIZE]!;
      break;
    } catch {
      continue;
    }
  }

  if (!density) {
    throw new Error('Chave inválida ou nenhum dado detectado');
  }

  const { compressed } = decodeFlags(flagsByte);
  onProgress?.(30, `Checksum validado — modo ${density}-LSB`);

  // Read meta length: auth + flags + 2
  const headerPrefixLen = AUTH_CHECKSUM_SIZE + FLAGS_SIZE + META_LENGTH_SIZE;
  const prefixSlots = await prepareSlots(
    req.keyBytes,
    req.width,
    req.height,
    slotsNeededForBytes(headerPrefixLen, density),
  );
  const prefix = readMultiLsb(req.imageData, prefixSlots, headerPrefixLen, density);
  const metaLen = new DataView(
    prefix.buffer,
    prefix.byteOffset,
    prefix.byteLength,
  ).getUint16(AUTH_CHECKSUM_SIZE + FLAGS_SIZE, false);

  const afterMeta =
    AUTH_CHECKSUM_SIZE +
    FLAGS_SIZE +
    META_LENGTH_SIZE +
    metaLen +
    PAYLOAD_LENGTH_SIZE;

  if (metaLen > 0xffff || afterMeta * 8 > capacityBitsAt(req.width, req.height, density)) {
    throw new Error('Chave inválida ou nenhum dado detectado');
  }

  onProgress?.(45, 'Lendo metadados do container');
  const headerSlots = await prepareSlots(
    req.keyBytes,
    req.width,
    req.height,
    slotsNeededForBytes(afterMeta, density),
  );
  const header = readMultiLsb(req.imageData, headerSlots, afterMeta, density);
  const headerView = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );

  const metaStart = AUTH_CHECKSUM_SIZE + FLAGS_SIZE + META_LENGTH_SIZE;
  const metaBytes = header.slice(metaStart, metaStart + metaLen);

  let metadata: SecretMetadata;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(metaBytes)) as SecretMetadata;
    if (!parsed || typeof parsed.name !== 'string') throw new Error('meta');
    metadata = {
      name: parsed.name,
      mimeType:
        typeof parsed.mimeType === 'string'
          ? parsed.mimeType
          : 'application/octet-stream',
    };
  } catch {
    throw new Error('Chave inválida ou nenhum dado detectado');
  }

  const payloadLen = headerView.getUint32(metaStart + metaLen, false);
  const totalBytes = afterMeta + payloadLen;
  if (totalBytes * 8 > capacityBitsAt(req.width, req.height, density)) {
    throw new Error('Chave inválida ou nenhum dado detectado');
  }

  onProgress?.(60, `Extraindo payload (${payloadLen} bytes)`);
  const allSlots = await prepareSlots(
    req.keyBytes,
    req.width,
    req.height,
    slotsNeededForBytes(totalBytes, density),
  );
  const stored = readMultiLsb(
    req.imageData,
    allSlots,
    payloadLen,
    density,
    afterMeta * 8,
  );

  onProgress?.(85, compressed ? 'Descomprimindo payload (deflate-raw)' : 'Payload bruto');
  const payload = await maybeDecompress(stored, compressed);

  onProgress?.(100, 'Arquivo reconstruído bit-a-bit');
  return { metadata, payload, density, compressed };
}
