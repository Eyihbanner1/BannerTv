import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../brand/tokens/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import { App } from './app/App';
import { startAddons } from './data/addons';
import { startPlaybackData } from './data/playback';
import { initI18n } from './i18n';
import { initNavigation } from './navigation/spatial';
import { bootInfo } from './platform/boot';
import { parseChromiumMajor, webOSReleaseForChromium } from './platform/engine';
import { initInputMode } from './platform/input-mode';
import { applyTuning, changedTuning } from './platform/tuning';
import { initLifecycle, isWebOS } from './platform/webos';

function fitToWindow(root: HTMLElement) {
  // The UI is drawn for 1920x1080. On the TV that is the window; on a laptop, scale to fit.
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  root.style.transform = scale < 1 ? `scale(${scale})` : '';
}

function start() {
  const root = document.getElementById('root');
  if (!root || window.__BANNERTV_UNSUPPORTED__) return;

  const chromium = parseChromiumMajor(navigator.userAgent);
  if (chromium !== null && webOSReleaseForChromium(chromium) === '5') {
    document.documentElement.classList.add('low-power');
  }
  applyTuning(document.documentElement);
  if (!isWebOS()) {
    fitToWindow(root);
    window.addEventListener('resize', () => fitToWindow(root));
  }

  initI18n();
  initNavigation();
  initInputMode();
  initLifecycle();
  startAddons();
  startPlaybackData();

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.info('[BannerTV] started', bootInfo, 'tuning', changedTuning());
}

start();
