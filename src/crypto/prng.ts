/**
 * Deterministic 32-bit PRNG (PCG-XSH-RR) seeded from SHA-256 key material.
 * Collision-free LSB channel permutation only — never for key generation.
 */

export interface Prng32 {
  nextUint32(): number;
  nextBounded(bound: number): number;
}

export function createPcg32(seedBytes: Uint8Array): Prng32 {
  if (seedBytes.length < 16) {
    throw new Error('Semente PRNG insuficiente (mín. 16 bytes)');
  }

  let state =
    (BigInt(readU32(seedBytes, 0)) << 32n) | BigInt(readU32(seedBytes, 4));
  const inc =
    ((BigInt(readU32(seedBytes, 8)) << 32n) | BigInt(readU32(seedBytes, 12))) |
    1n;

  const MULT = 6364136223846793005n;
  state = (state + inc) & 0xffffffffffffffffn;

  function nextUint32(): number {
    const old = state;
    state = (old * MULT + inc) & 0xffffffffffffffffn;
    const xorshifted = Number(((old >> 18n) ^ old) >> 27n) & 0xffffffff;
    const rot = Number(old >> 59n) & 31;
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  }

  function nextBounded(bound: number): number {
    if (bound <= 0 || bound > 0x100000000) {
      throw new Error('bound inválido');
    }
    if ((bound & (bound - 1)) === 0) {
      return nextUint32() & (bound - 1);
    }
    const limit = (0x100000000 - (0x100000000 % bound)) >>> 0;
    let r = 0;
    do {
      r = nextUint32();
    } while (r >= limit);
    return r % bound;
  }

  return { nextUint32, nextBounded };
}

function readU32(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  );
}

/**
 * Partial Fisher-Yates: `count` unique indices in [0, universe).
 * Uses dense array when selection is large (avoids Map OOM on 4K/8K covers).
 */
export function uniqueIndices(prng: Prng32, universe: number, count: number): Uint32Array {
  if (count > universe) {
    throw new Error(
      `Capacidade insuficiente: precisa de ${count} slots, disponível ${universe}`,
    );
  }
  if (count <= 0) return new Uint32Array(0);

  const useDense = count > 250_000 || count * 2 > universe;

  if (useDense) {
    const arr = new Uint32Array(universe);
    for (let i = 0; i < universe; i++) arr[i] = i >>> 0;
    for (let i = 0; i < count; i++) {
      const j = i + prng.nextBounded(universe - i);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr.slice(0, count);
  }

  const map = new Map<number, number>();
  const result = new Uint32Array(count);

  for (let i = 0; i < count; i++) {
    const j = i + prng.nextBounded(universe - i);
    const atJ = map.has(j) ? map.get(j)! : j;
    const atI = map.has(i) ? map.get(i)! : i;
    map.set(j, atI);
    map.set(i, atJ);
    result[i] = atJ >>> 0;
  }

  return result;
}

/** Slot s → ImageData byte offset (RGBA). Alpha never selected. */
export function slotToByteOffset(slot: number): number {
  const pixel = (slot / 3) | 0;
  const channel = slot % 3;
  return (pixel * 4 + channel) >>> 0;
}
