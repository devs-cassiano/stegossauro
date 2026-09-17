type PanicFn = () => void;

const PROD = import.meta.env.PROD;

/** Main-thread global (never import this module into a Worker). */
const g = globalThis as typeof globalThis & {
  setTimeout: typeof setTimeout;
  addEventListener: typeof addEventListener;
};

function randDelay(): number {
  return 800 + Math.floor(Math.random() * 1400);
}

function trapDebugger(): void {
  // eslint-disable-next-line no-debugger
  debugger;
}

function armDebuggerLoop(): void {
  const tick = (): void => {
    try {
      trapDebugger();
    } catch {
      /* ignore */
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

function armTimingWatch(onPanic: PanicFn): void {
  let last = performance.now();
  const THRESHOLD_MS = 280;

  const pulse = (): void => {
    const now = performance.now();
    const delta = now - last;
    last = now;
    if (delta > THRESHOLD_MS * 8) {
      onPanic();
    }
    g.setTimeout(pulse, THRESHOLD_MS + Math.floor(Math.random() * 120));
  };
  g.setTimeout(pulse, THRESHOLD_MS);
}

export function armClientShield(onPanic: PanicFn): void {
  if (!PROD) return;
  if (typeof document === 'undefined') return;
  armShortcutShield();
  armDebuggerLoop();
  armTimingWatch(onPanic);
}
