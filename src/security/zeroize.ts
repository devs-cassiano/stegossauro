export function zeroize(
  buf: Uint8Array | Uint8ClampedArray | ArrayBuffer | null | undefined,
): void {
  if (!buf) return;
  try {
    if (buf instanceof ArrayBuffer) {
      new Uint8Array(buf).fill(0);
      return;
    }
    buf.fill(0);
  } catch {
    /* detached / neutered buffer */
  }
}

export function zeroizeAll(
  ...bufs: Array<Uint8Array | Uint8ClampedArray | ArrayBuffer | null | undefined>
): void {
  for (const b of bufs) zeroize(b);
}
