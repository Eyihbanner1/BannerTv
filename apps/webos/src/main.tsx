// First, so it reads the clock as the bundle starts to run (a launch mark).
import { bootInfo } from './platform/boot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../brand/tokens/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import { App } from './app/App';
import { startBootMarks } from './app/boot-marks';
import { startAddons } from './data/addons';
import { checkServiceStatus } from './data/api';
import { startStreamHelper } from './data/helper';
import { startLibraryData } from './data/library';
import { startOpenLinks } from './data/open-link';
import { startPlaybackData } from './data/playback';
import { askAgainOnRelaunch } from './data/profiles';
import {
  holdSportsMatcher,
  startSports,
  traceSportsMatcher,
  wantSportsMatcher,
} from './data/sports';
import { startLgUpdates } from './data/lg-updates';
import { startSync } from './data/sync';
import { startTrakt } from './data/trakt';
import { startWatchNext } from './data/watch-next';
import { initI18n } from './i18n';
import { initNavigation } from './navigation/spatial';
import { androidWatchNext, initAndroid, isAndroid, takeAndroidLink } from './platform/android';
import { parseChromiumMajor, webOSReleaseForChromium } from './platform/engine';
import { startFrameMeter } from './platform/frame-meter';
import { initInputMode } from './platform/input-mode';
import { afterLaunch } from './platform/launch';
import { bootMark, mark } from './platform/marks';
import { noteAppStarted } from './platform/shell';
import { applyTuning, changedTuning, tuning } from './platform/tuning';
import { initLifecycle, isWebOS } from './platform/webos';
import { readPlayMarks } from './player/play-marks';

function fitToWindow(root: HTMLElement) {
  // The UI is drawn for 1920x1080. On the TV that is the window; on a laptop or a phone,
  // scale to fit, in the middle. The window is measured on the root element: a phone's
  // browser widens innerWidth to the 1920px page, so the UI would barely shrink.
  const html = document.documentElement;
  const width = html.clientWidth;
  const height = html.clientHeight;
  const scale = Math.min(width / 1920, height / 1080);
  const scaled = scale < 1;
  root.style.transform = scaled
    ? `translate(${(width - 1920 * scale) / 2}px, ${(height - 1080 * scale) / 2}px) scale(${scale})`
    : '';
  // base.css makes the page 1920x1080, which a phone would let the person pan about.
  for (const element of [html, document.body]) {
    element.style.width = scaled ? `${width}px` : '';
    element.style.height = scaled ? `${height}px` : '';
  }
}

function start() {
  const root = document.getElementById('root');
  if (!root || window.__BANNERTV_UNSUPPORTED__) return;

  const chromium = parseChromiumMajor(navigator.userAgent);
  if (chromium !== null && webOSReleaseForChromium(chromium) === '5') {
    document.documentElement.classList.add('low-power');
  }
  applyTuning(document.documentElement);
  startFrameMeter();
  // The stages of the latest Play, read from the web inspector.
  if (tuning.marks) window.__bannertvPlay = readPlayMarks;
  if (!isWebOS()) {
    fitToWindow(root);
    window.addEventListener('resize', () => fitToWindow(root));
  }

  initI18n();
  initNavigation();
  initInputMode();
  initLifecycle(askAgainOnRelaunch);
  // A card on Android's own home screen opens its title, cold or while the app runs.
  const onOpen = isAndroid() ? startOpenLinks(takeAndroidLink) : undefined;
  initAndroid({ onRelaunch: askAgainOnRelaunch, onOpen });
  startStreamHelper();
  startAddons();
  startPlaybackData();
  startLibraryData();
  checkServiceStatus();
  startTrakt();
  if (tuning.matcherAt === 'idle') {
    holdSportsMatcher();
    afterLaunch(wantSportsMatcher);
  }
  void startSports();
  startSync();
  startLgUpdates();
  const publishWatchNext = androidWatchNext();
  if (publishWatchNext) startWatchNext(publishWatchNext);
  // After the reads above have started, so watching them changes no order.
  startBootMarks();
  if (tuning.marks) traceSportsMatcher(mark);

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.info('[BannerTV] started', bootInfo, 'tuning', changedTuning());
  bootMark('boot:start-end');
  // Last: the loader counts a stored update as started only once its script has run to here.
  noteAppStarted();
}

start();
