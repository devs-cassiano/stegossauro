import './styles.css';
import { assertRuntimeIntegrity } from './security/integrity';
import { armClientShield } from './security/shield';
import { scrubAuthCache } from './security/veil';
import { UiController } from './ui/controller';

const app = document.querySelector<HTMLElement>('#app');
if (!app) {
  throw new Error('#app não encontrado');
}

if (!assertRuntimeIntegrity()) {
  app.textContent = 'Ambiente comprometido — APIs nativas alteradas.';
  throw new Error('integrity');
}

const ui = new UiController(app);

armClientShield(() => {
  // Timing stalls must not remount UI (handled inside shield). Soft scrub only.
  scrubAuthCache();
});

globalThis.addEventListener('pagehide', () => {
  scrubAuthCache();
  ui.destroy();
});
