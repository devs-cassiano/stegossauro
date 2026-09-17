/**
 * Neutral, innocuous download names — anti-forensic opacity.
 * Never emit stego_/hidden_/secret_/payload_/carrier_/vault_ prefixes.
 */

/** Stems that reveal steganographic intent (prefix or whole token). */
const FORBIDDEN_STEM =
  /(^|[_\-. ])(stego|hidden|secret|payload|carrier|disfarce|vault|stegoshield|stegossauro|embedded)([_\-. ]|$)/i;

const FORBIDDEN_PREFIX =
  /^(stego|hidden|secret|payload|carrier|disfarce|vault|stegoshield|stegossauro)/i;

/** Camera-roll style default: IMG_YYYYMMDD_HHMMSS.png */
export function suggestInnocentPngName(date = new Date()): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `IMG_${y}${mo}${d}_${h}${mi}${s}.png`;
}

/** Alternate innocent suggestions (for optional reshuffle). */
export function suggestAlternatePngName(date = new Date()): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const seq = 1000 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 9000);
  const variants = [
    `IMG_${y}${mo}${d}_${h}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}.png`,
    `DSC_${seq}.png`,
    `Screenshot_${y}-${mo}-${d}_${h}.png`,
    `IMG_${y}${mo}${d}.png`,
  ];
  return variants[crypto.getRandomValues(new Uint8Array(1))[0]! % variants.length]!;
}

const NEUTRAL_KEY_NAMES = [
  'auth_token.key',
  'recovery_backup.key',
  'session_restore.key',
  'license_backup.key',
] as const;

export function suggestNeutralKeyName(): string {
  const i = crypto.getRandomValues(new Uint8Array(1))[0]! % NEUTRAL_KEY_NAMES.length;
  return NEUTRAL_KEY_NAMES[i]!;
}

/** Derive `[outputBase]_backup.key` from the chosen PNG name (forensic-neutral). */
export function suggestKeyNameFromOutput(pngName: string): string {
  const stem = pngName
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.png$/i, '')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80);
  if (!stem || /^(stego|secret|hidden|vault|payload|carrier)/i.test(stem)) {
    return suggestNeutralKeyName();
  }
  return `${stem}_backup.key`;
}

/**
 * Force .png extension; strip path segments; neutralize forbidden stems.
 */
export function normalizeOutputPngName(raw: string): string {
  let base = raw.trim().replace(/\\/g, '/').split('/').pop() ?? '';
  base = base.replace(/[^\w.\- ()[\]]+/g, '_');
  if (!base) base = suggestInnocentPngName();

  const stem = base.replace(/\.[^.]+$/i, '');
  let safeStem = stem.length > 0 ? stem.slice(0, 180) : 'IMG_export';
  if (FORBIDDEN_STEM.test(safeStem) || FORBIDDEN_PREFIX.test(safeStem)) {
    safeStem = suggestInnocentPngName().replace(/\.png$/i, '');
  }
  return `${safeStem}.png`;
}

/** Fallback basename for restored payloads when metadata name is empty. */
export function fallbackRestoredName(): string {
  return 'document.bin';
}
