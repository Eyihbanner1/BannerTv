import { fixtureRows, loadLiveRows } from './data';
import { HtmlView } from './html-view';
import { LightningView } from './lightning-view';
import {
  type Direction,
  type Focus,
  focusedTitle,
  type HomeRow,
  initialFocus,
  LAYOUT,
  move,
} from './model';
import { addResult, clearResults, readResults, type TrialResult } from './results';
import { FrameRecorder, heapMb } from './stats';
import { MODE_LABELS, type Mode, MODES, type HomeView } from './view';
import { play, walkFor } from './walk';
import './page.css';

declare global {
  interface Window {
    webOSSystem?: { platformBack?: () => void };
    PalmSystem?: { platformBack?: () => void };
    /** For the browser tests: what the trial is doing. */
    __motionTrial?: {
      phase: string;
      mode?: Mode;
      error?: string;
      report?: () => Record<string, number | string | null>;
    };
  }
}

const KEYS: Record<number, Direction | 'ok' | 'back' | 'walk'> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  461: 'back',
  27: 'back',
  8: 'back',
  48: 'walk',
  96: 'walk',
};

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const status = (phase: string, extra: Partial<NonNullable<Window['__motionTrial']>> = {}) => {
  window.__motionTrial = { ...window.__motionTrial, phase, ...extra };
};

const DATA_KEY = 'bannertv.motionTrial.data';
function useFixture(): boolean {
  if (params.get('fixture') === '1') return true;
  try {
    return localStorage.getItem(DATA_KEY) === 'fixture';
  } catch {
    return false;
  }
}

function go(query: Record<string, string>): void {
  const search = new URLSearchParams(query);
  if (params.get('fixture') === '1') search.set('fixture', '1');
  location.replace(`${location.pathname}?${search.toString()}`);
}

function leaveApp(): void {
  const system = window.webOSSystem ?? window.PalmSystem;
  if (system && system.platformBack) system.platformBack();
  else window.close();
}

// ---- Menu -------------------------------------------------------------------

interface MenuItem {
  label: string;
  run: () => void;
}

function showMenu(): void {
  status('menu');
  const results = readResults();
  const items: MenuItem[] = [
    {
      label: 'Run all three tests (about 2 minutes)',
      run: () => go({ mode: MODES[0]!, walk: '1', suite: '1' }),
    },
    ...MODES.map((mode) => ({ label: `Try: ${MODE_LABELS[mode]}`, run: () => go({ mode }) })),
    { label: `Show results (${results.length})`, run: () => go({ results: '1' }) },
    {
      label: `Pictures: ${useFixture() ? 'made-up (no network)' : 'real, from Cinemeta'}`,
      run: () => {
        try {
          localStorage.setItem(DATA_KEY, useFixture() ? 'live' : 'fixture');
        } catch {
          // Not kept: the choice lasts this page only.
        }
        showMenu();
      },
    },
    {
      label: 'Clear results',
      run: () => {
        clearResults();
        showMenu();
      },
    },
  ];
  let index = 0;
  app.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'mt-page';
  page.innerHTML =
    '<h1>BannerTV motion trial</h1>' +
    '<p class="mt-lead">Home with sliding rows, a growing focused tile and a fading hero, drawn three ways. ' +
    'Each test walks Home by itself, the same way, and times every frame. In a Try, press 0 to run the walk.</p>';
  const list = document.createElement('div');
  page.appendChild(list);
  app.appendChild(page);
  const buttons = items.map((item, i) => {
    const button = document.createElement('div');
    button.className = 'mt-button';
    button.textContent = item.label;
    button.addEventListener('click', item.run);
    button.addEventListener('mousemove', () => select(i));
    list.appendChild(button);
    return button;
  });
  const select = (i: number) => {
    buttons[index]!.classList.remove('mt-selected');
    index = i;
    buttons[index]!.classList.add('mt-selected');
  };
  select(0);
  onKeys((key) => {
    if (key === 'up') select(Math.max(0, index - 1));
    else if (key === 'down') select(Math.min(buttons.length - 1, index + 1));
    else if (key === 'ok') items[index]!.run();
    else if (key === 'back') leaveApp();
  });
}

// ---- Results ----------------------------------------------------------------

function showResults(): void {
  status('results');
  const results = readResults();
  app.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'mt-page';
  const rows = results
    .map(
      (r) =>
        `<tr><td>${MODE_LABELS[r.mode]}</td>` +
        `<td>${r.firstWalkDown.p95} / ${r.firstWalkDown.max}</td>` +
        `<td>${r.browse.p95} / ${r.browse.max}</td>` +
        `<td>${r.browse.missed + r.firstWalkDown.missed}</td>` +
        `<td>${r.browse.stutters + r.firstWalkDown.stutters}</td>` +
        `<td>${r.heapMb ?? '–'}</td>` +
        `<td>${r.report.textureMb ?? '–'}</td>` +
        `<td>${r.mountMs}</td>` +
        `<td>${r.data}</td></tr>`,
    )
    .join('');
  page.innerHTML =
    '<h1>Results</h1>' +
    '<p class="mt-lead">Frame gaps in milliseconds: 17 is smooth on a 60 Hz TV; over 33 a frame was missed; ' +
    'over 100 anyone sees a stutter. Lower is better everywhere.</p>' +
    '<table class="mt-table"><tr><th>Mode</th><th>First walk down<br>p95 / worst</th>' +
    '<th>Browsing<br>p95 / worst</th><th>Missed<br>frames</th><th>Stutters</th>' +
    '<th>JS heap<br>MB</th><th>Textures<br>MB</th><th>Home up<br>ms</th><th>Pictures</th></tr>' +
    rows +
    '</table><p class="mt-lead">Back returns to the menu.</p>';
  app.appendChild(page);
  console.info('[motion-trial] results', JSON.stringify(results));
  onKeys((key) => {
    if (key === 'back' || key === 'ok') go({});
  });
}

// ---- Home -------------------------------------------------------------------

async function showHome(mode: Mode): Promise<void> {
  status('loading', { mode });
  const started = performance.now();
  const fixture = useFixture();
  let rows: HomeRow[] = fixture ? [] : await loadLiveRows();
  const data = rows.length > 0 ? 'real' : 'made-up';
  if (rows.length === 0) rows = await fixtureRows();

  app.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'mt-stage';
  app.appendChild(host);
  const view: HomeView =
    mode === 'html'
      ? new HtmlView(host)
      : new LightningView(host, mode === 'lightning-1080' ? 1 : window.devicePixelRatio || 1);
  let focus: Focus = initialFocus(rows);
  await view.mount(rows, focus);
  const mountMs = Math.round(performance.now() - started);
  view.hero(focusedTitle(focus, rows));

  let heroTimer = 0;
  const press = (direction: Direction) => {
    const next = move(focus, rows, direction);
    if (next === focus) return;
    focus = next;
    view.focus(next);
    clearTimeout(heroTimer);
    heroTimer = window.setTimeout(() => view.hero(focusedTitle(focus, rows)), LAYOUT.heroDelayMs);
  };

  let walking = false;
  const runWalk = async () => {
    if (walking) return;
    walking = true;
    status('walking', { mode });
    const walk = walkFor(rows);
    const recorder = new FrameRecorder();
    recorder.start();
    await play(walk.firstWalkDown, press);
    const firstWalkDown = recorder.stop();
    // Back to the top, then browse rows whose art has been seen.
    while (focus.row > 0) press('up');
    await new Promise((done) => setTimeout(done, 1500));
    recorder.start();
    await play(walk.browse, press);
    const browse = recorder.stop();
    const result: TrialResult = {
      mode,
      at: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio || 1,
      data,
      mountMs,
      firstWalkDown,
      browse,
      heapMb: heapMb(),
      report: view.report(),
    };
    addResult(result);
    console.info('[motion-trial] result', JSON.stringify(result));
    walking = false;
    if (params.get('suite') === '1') {
      const next = MODES[MODES.indexOf(mode) + 1];
      if (next) go({ mode: next, walk: '1', suite: '1' });
      else go({ results: '1' });
      return;
    }
    status('ready', { mode });
  };

  onKeys((key) => {
    if (walking) return;
    if (key === 'back') go({});
    else if (key === 'walk') void runWalk();
    else if (key !== 'ok') press(key);
  });
  status('ready', { mode, report: () => view.report() });
  if (params.get('walk') === '1') {
    // Let the first row's art arrive, as a viewer would before pressing.
    setTimeout(() => void runWalk(), 2500);
  }
}

// ---- Start ------------------------------------------------------------------

let keyHandler: ((key: Direction | 'ok' | 'back' | 'walk') => void) | null = null;
function onKeys(handler: (key: Direction | 'ok' | 'back' | 'walk') => void): void {
  keyHandler = handler;
}
document.addEventListener('keydown', (event) => {
  const key = KEYS[event.keyCode];
  if (!key || !keyHandler) return;
  event.preventDefault();
  keyHandler(key);
});

function start(): void {
  const mode = params.get('mode') as Mode | null;
  if (params.get('results') === '1') showResults();
  else if (mode && MODES.indexOf(mode) >= 0) {
    showHome(mode).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      status('error', { mode, error: message });
      app.innerHTML = `<div class="mt-page"><h1>This mode failed to start</h1><p class="mt-lead">${message}</p></div>`;
      onKeys(() => go({}));
    });
  } else showMenu();
}

start();
