function looksNative(fn: (...args: never[]) => unknown): boolean {
  try {
    const src = Function.prototype.toString.call(fn);
    return typeof fn === 'function' && src.includes('[native code]');
  } catch {
    return false;
  }
}

/** Main-thread only — do not import from Worker. */
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

    if (typeof document !== 'undefined') {
      const draw =
        typeof CanvasRenderingContext2D !== 'undefined'
          ? CanvasRenderingContext2D.prototype?.drawImage
          : undefined;
      if (draw && !looksNative(draw as (...args: never[]) => unknown)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
