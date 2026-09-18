type PanicFn = () => void;

const PROD = import.meta.env.PROD;

const g = globalThis as typeof globalThis & {
  setTimeout: typeof setTimeout;
  addEventListener: typeof addEventListener;
};

let heavyOps = 0;

/** Pause anti-debug timing while main thread may block (decode / I/O). */
export function beginHeavyWork(): void {
  heavyOps += 1;
}

export function endHeavyWork(): void {
  heavyOps = Math.max(0, heavyOps - 1);
}

function randDelay(): number {
  return 1200 + Math.floor(Math.random() * 1800);
}

function trapDebugger(): void {
  // eslint-disable-next-line no-debugger
  debugger;
}

function armDebuggerLoop(): void {
  const tick = (): void => {
    if (heavyOps === 0) {
      try {
        trapDebugger();
      } catch {
        /* ignore */
      }
    }
    g.setTimeout(tick, randDelay());
  };
  g.setTimeout(tick, randDelay());
}

function armShortcutShield(): void {
  g.addEventListener(
    'keydown',
    (e: Event) => {
      const ke = e as KeyboardEvent;
      const key = ke.key?.toLowerCase?.() ?? '';
      const ctrl = ke.ctrlKey || ke.metaKey;
      const shift = ke.shiftKey;
      const block =
        ke.key === 'F12' ||
        (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) ||
        (ctrl && key === 'u') ||
        (ke.metaKey && ke.altKey && (key === 'i' || key === 'j'));
      if (block) {
        ke.preventDefault();
        ke.stopPropagation();
      }
    },
    true,
  );

  g.addEventListener(
    'contextmenu',
    (e: Event) => {
      e.preventDefault();
    },
    true,
  );
}

/**
 * Timing anomalies must NEVER remount the UI.
 * Large image decode / LSB mapping legitimately blocks the main thread for seconds.
 */
function armTimingWatch(_onAnomaly: PanicFn): void {
  let last = performance.now();
  const IDLE_MS = 400;

  const pulse = (): void => {
    const now = performance.now();
    const delta = now - last;
    last = now;
    // Intentionally no panicWipe / location.reload — stalls are expected under load.
    void delta;
    void _onAnomaly;
    g.setTimeout(pulse, IDLE_MS + Math.floor(Math.random() * 200));
  };
  g.setTimeout(pulse, IDLE_MS);
}

export function armClientShield(onPanic: PanicFn): void {
  if (!PROD) return;
  if (typeof document === 'undefined') return;
  armShortcutShield();
  armDebuggerLoop();
  // Keep callback for API compat but timing watch does not remount.
  armTimingWatch(onPanic);
}
