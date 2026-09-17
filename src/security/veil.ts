const _k = Object.freeze([0xa7, 0x3b, 0xc1, 0x19, 0xe2, 0x4d, 0x88, 0x71]);

const _auth = Object.freeze([
  244, 79, 164, 126, 141, 30, 224, 24, 194, 87, 165, 52, 163, 56, 252, 25, 138, 77,
  240,
]);

function unveil(packed: readonly number[]): string {
  const raw = new Uint8Array(packed.length);
  for (let i = 0; i < packed.length; i++) {
    raw[i] = packed[i]! ^ _k[i % _k.length]!;
  }
  const out = new TextDecoder().decode(raw);
  raw.fill(0);
  return out;
}

let _authCache: string | null = null;

export function authTag(): string {
  if (_authCache === null) _authCache = unveil(_auth);
  return _authCache;
}

export function scrubAuthCache(): void {
  _authCache = null;
}
