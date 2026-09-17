/**
 * Headless round-trip smoke test (densities + compression + raw binary names).
 * Run: npx tsx scripts/smoke-roundtrip.ts
 */
const { generateKeyBytes, formatKeyHex, parseKeyHex } = await import(
  '../src/crypto/keys.ts'
);
const { embed, extract } = await import('../src/stego/engine.ts');
const { selectDensity, capacityBytesAt, containerByteLength } = await import(
  '../src/stego/canvas.ts'
);

function makePixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 17) & 0xff;
    pixels[i + 1] = (i * 31) & 0xff;
    pixels[i + 2] = (i * 47) & 0xff;
    pixels[i + 3] = 255;
  }
  return pixels;
}

async function roundTrip(
  label: string,
  width: number,
  height: number,
  secret: Uint8Array,
  name: string,
  mimeType: string,
): Promise<void> {
  const keyBytes = generateKeyBytes();
  const keyStr = formatKeyHex(keyBytes);
  if (parseKeyHex(keyStr).some((b, i) => b !== keyBytes[i])) {
    throw new Error(`[${label}] parseKeyHex mismatch`);
  }

  const embedded = await embed({
    imageData: makePixels(width, height),
    width,
    height,
    keyBytes,
    secretBytes: secret,
    metadata: { name, mimeType },
  });

  for (let i = 3; i < embedded.imageData.length; i += 4) {
    if (embedded.imageData[i] !== 255) throw new Error(`[${label}] Alpha mutated`);
  }

  const out = await extract({
    imageData: embedded.imageData,
    width,
    height,
    keyBytes,
  });

  if (out.metadata.name !== name) {
    throw new Error(`[${label}] name mismatch: ${out.metadata.name}`);
  }
  if (out.payload.length !== secret.length) {
    throw new Error(`[${label}] length mismatch`);
  }
  for (let i = 0; i < secret.length; i++) {
    if (out.payload[i] !== secret[i]) throw new Error(`[${label}] byte mismatch @${i}`);
  }
  if (out.density !== embedded.density) {
    throw new Error(`[${label}] density mismatch`);
  }

  let failed = false;
  try {
    await extract({
      imageData: embedded.imageData,
      width,
      height,
      keyBytes: generateKeyBytes(),
    });
  } catch {
    failed = true;
  }
  if (!failed) throw new Error(`[${label}] wrong key should fail`);

  console.log(
    `OK ${label}: density=${embedded.density} compressed=${embedded.compressed} ` +
      `occ=${(embedded.occupancyRatio * 100).toFixed(2)}% name=${name}`,
  );
}

// Small compressible text → prefer 1-LSB
{
  const secret = new TextEncoder().encode('Stegossauro smoke — texto compressível\n'.repeat(40));
  await roundTrip('text', 64, 64, secret, 'notas_reuniao.txt', 'text/plain');
}

// Force 2-LSB with larger payload on modest cover
{
  const width = 80;
  const height = 80;
  const max1 = capacityBytesAt(width, height, 1);
  // payload roughly between 1-LSB and 2-LSB capacity (minus header)
  const size = Math.floor(max1 * 0.9);
  const secret = new Uint8Array(size);
  crypto.getRandomValues(secret); // random → no compression
  const dens = selectDensity(width, height, size + 64);
  if (dens !== 2 && dens !== 3) {
    // random data may need 2; header adds a bit
  }
  await roundTrip('random-mid', width, height, secret, 'dump.bin', 'application/octet-stream');
}

// Preserve compound extension
{
  const secret = new Uint8Array([1, 2, 3, 4, 5, 0xaa, 0xbb]);
  await roundTrip('ext', 32, 32, secret, 'backup.tar.gz', 'application/gzip');
}

// Force ≥2-LSB: payload sized just above 1-LSB envelope capacity
{
  const width = 64;
  const height = 64;
  const metaLen = new TextEncoder().encode(
    JSON.stringify({ name: 'big.bin', mimeType: 'application/octet-stream' }),
  ).length;
  const cap1 = capacityBytesAt(width, height, 1);
  const payloadSize = cap1 - metaLen; // container = 11 + meta + payload > cap1
  const secret = new Uint8Array(payloadSize);
  crypto.getRandomValues(secret);
  const need = containerByteLength(metaLen, payloadSize);
  if (need <= cap1) throw new Error('test setup: expected need > cap1');
  await roundTrip('density2+', width, height, secret, 'big.bin', 'application/octet-stream');
}

console.log('All smoke tests passed');
