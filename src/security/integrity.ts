function looksNative(fn: (...args: never[]) => unknown): boolean {
  try {
    const src = Function.prototype.toString.call(fn);
    return typeof fn === 'function' && src.includes('[native code]');
  } catch {
    return false;
  }
}

export function assertRuntimeIntegrity(): boolean {
  try {
    if (typeof crypto === 'undefined' || !crypto.getRandomValues || !crypto.subtle) {
      return false;
    }
    if (!looksNative(crypto.getRandomValues as (...args: never[]) => unknown)) {
      return false;
    }
    if (!looksNative(crypto.subtle.digest as (...args: never[]) => unknown)) {
      return false;
    }

    const draw = CanvasRenderingContext2D?.prototype?.drawImage;
    if (draw && !looksNative(draw as (...args: never[]) => unknown)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
