type PanicFn = () => void;

const PROD = import.meta.env.PROD;

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
    window.setTimeout(tick, randDelay());
  };
  window.setTimeout(tick, randDelay());
}

function armShortcutShield(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      const key = e.key?.toLowerCase?.() ?? '';
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const block =
        e.key === 'F12' ||
        (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) ||
        (ctrl && key === 'u') ||
        (e.metaKey && e.altKey && (key === 'i' || key === 'j'));
      if (block) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  window.addEventListener(
    'contextmenu',
    (e) => {
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
    window.setTimeout(pulse, THRESHOLD_MS + Math.floor(Math.random() * 120));
  };
  window.setTimeout(pulse, THRESHOLD_MS);
}

export function armClientShield(onPanic: PanicFn): void {
  if (!PROD) return;
  armShortcutShield();
  armDebuggerLoop();
  armTimingWatch(onPanic);
}
