import appinfo from '../../webos-meta/appinfo.json';
import { recentBackTimes } from '../navigation/back-timing';
import { bootInfo } from './boot';
import {
  isSupportedEngine,
  parseChromiumMajor,
  webOSReleaseForChromium,
  webOSReleaseForSdkVersion,
} from './engine';
import { changedTuning } from './tuning';
import { isWebOS, lunaCall, readDeviceInfo } from './webos';

export type DiagnosticRow = readonly [label: string, value: string];

export interface DiagnosticSection {
  title: string;
  rows: DiagnosticRow[];
}

/** Codec strings to probe with canPlayType (native player) and MediaSource (MSE). */
const MEDIA_TYPES: ReadonlyArray<readonly [label: string, type: string]> = [
  ['H.264 (MP4)', 'video/mp4; codecs="avc1.640028"'],
  ['HEVC Main (hev1)', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  ['HEVC Main10 (hvc1)', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
  ['Dolby Vision P5', 'video/mp4; codecs="dvhe.05.06"'],
  ['Dolby Vision P8', 'video/mp4; codecs="dvh1.08.06"'],
  ['AV1', 'video/mp4; codecs="av01.0.08M.08"'],
  ['VP9 (WebM)', 'video/webm; codecs="vp9"'],
  ['AAC', 'audio/mp4; codecs="mp4a.40.2"'],
  ['Dolby Digital (AC-3)', 'audio/mp4; codecs="ac-3"'],
  ['Dolby Digital Plus', 'audio/mp4; codecs="ec-3"'],
  ['Opus (WebM)', 'audio/webm; codecs="opus"'],
  ['Matroska', 'video/x-matroska'],
  ['MPEG-TS', 'video/mp2t'],
  ['HLS', 'application/vnd.apple.mpegurl'],
];

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

function text(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function settle<T>(promise: Promise<T>): Promise<T | Error> {
  try {
    return await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function checkLocalStorage(): string {
  try {
    const key = '__bannertv_probe__';
    localStorage.setItem(key, '1');
    const ok = localStorage.getItem(key) === '1';
    localStorage.removeItem(key);
    return ok ? 'works' : 'read back failed';
  } catch (error) {
    return `fails: ${String(error)}`;
  }
}

function checkIndexedDB(): Promise<string> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve('not available');
      return;
    }
    try {
      const request = indexedDB.open('bannertv-probe', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('probe');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('probe', 'readwrite');
        tx.objectStore('probe').put(Date.now(), 'last');
        tx.oncomplete = () => {
          db.close();
          resolve('works');
        };
        tx.onerror = () => resolve(`write fails: ${String(tx.error)}`);
      };
      request.onerror = () => resolve(`open fails: ${String(request.error)}`);
    } catch (error) {
      resolve(`fails: ${String(error)}`);
    }
  });
}

function mediaRows(): DiagnosticRow[] {
  const video = document.createElement('video');
  const mse = typeof MediaSource !== 'undefined';
  const rows: DiagnosticRow[] = MEDIA_TYPES.map(([label, type]) => {
    const native = video.canPlayType(type) || 'no';
    const viaMse = mse && MediaSource.isTypeSupported(type) ? 'yes' : 'no';
    return [label, `${native} / ${viaMse}`];
  });
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  rows.push(['audioTracks API', yesNo('audioTracks' in proto)]);
  rows.push(['videoTracks API', yesNo('videoTracks' in proto)]);
  rows.push(['textTracks API', yesNo('textTracks' in proto)]);
  return rows;
}

async function tvRows(): Promise<DiagnosticRow[]> {
  if (!isWebOS()) return [['Running on webOS', 'no (laptop or test browser)']];
  const device = readDeviceInfo() ?? {};
  const rows: DiagnosticRow[] = [
    ['Model', text(device.modelName)],
    ['Screen', `${text(device.screenWidth)} x ${text(device.screenHeight)}`],
  ];

  const [system, configs] = await Promise.all([
    settle(
      lunaCall('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
        keys: ['modelName', 'firmwareVersion', 'UHD', 'OLED', 'sdkVersion'],
      }),
    ),
    settle(
      lunaCall<{ configs?: Record<string, unknown> }>(
        'luna://com.webos.service.config/getConfigs',
        {
          configNames: [
            'tv.model.supportHDR',
            'tv.config.supportDolbyHDRContents',
            'tv.hw.panelResolution',
            'tv.hw.displayType',
            'tv.hw.ddrSize',
          ],
        },
      ),
    ),
  ]);

  if (system instanceof Error) {
    rows.push(['getSystemInfo', system.message]);
    // deviceInfo's platformVersion is the firmware version, not the webOS release.
    rows.push(['Firmware', text(device.platformVersion)]);
  } else {
    const sdk = text(system.sdkVersion);
    rows.push(['Firmware', text(system.firmwareVersion)]);
    rows.push(['SDK version', `${sdk} (webOS ${webOSReleaseForSdkVersion(sdk) ?? '?'})`]);
    rows.push(['UHD panel', text(system.UHD)]);
    rows.push(['OLED', text(system.OLED)]);
  }
  if (configs instanceof Error) {
    rows.push(['getConfigs', configs.message]);
  } else {
    const c = configs.configs ?? {};
    rows.push(['HDR10', text(c['tv.model.supportHDR'])]);
    rows.push(['Dolby Vision', text(c['tv.config.supportDolbyHDRContents'])]);
    rows.push(['Panel', `${text(c['tv.hw.panelResolution'])} ${text(c['tv.hw.displayType'])}`]);
    rows.push(['Memory', text(c['tv.hw.ddrSize'])]);
  }
  return rows;
}

function tuningText(): string {
  const changed = changedTuning();
  return Object.keys(changed).length > 0 ? JSON.stringify(changed) : 'defaults';
}

function backTimes(): string {
  const times = recentBackTimes();
  return times.length > 0 ? `${times.join(', ')} ms` : 'press Back on another screen first';
}

export async function collectDiagnostics(): Promise<DiagnosticSection[]> {
  const ua = navigator.userAgent;
  const chromium = parseChromiumMajor(ua);
  const [indexedDBResult, tv] = await Promise.all([checkIndexedDB(), tvRows()]);

  return [
    {
      title: 'Spike 1: packaged app',
      rows: [
        ['App', `${appinfo.id} ${appinfo.version}`],
        ['Loaded from', location.protocol],
        ['Bundle', bootInfo.loadedAsClassicScript ? 'classic script' : 'module script'],
        ['Script', bootInfo.scriptSrc.split('/').pop() || '—'],
        ['Font', document.fonts.check('600 24px Urbanist') ? 'Urbanist loaded' : 'fallback'],
        ['localStorage', checkLocalStorage()],
        ['IndexedDB', indexedDBResult],
        ['Back response', backTimes()],
        ['Tuning', tuningText()],
      ],
    },
    {
      title: 'Web engine',
      rows: [
        ['Chromium', chromium === null ? '—' : String(chromium)],
        [
          'webOS release',
          chromium === null ? '—' : (webOSReleaseForChromium(chromium) ?? 'older than 3'),
        ],
        ['Supported', yesNo(isSupportedEngine(ua))],
        ['Window', `${window.innerWidth} x ${window.innerHeight} @ ${window.devicePixelRatio}x`],
        ['User agent', ua],
      ],
    },
    { title: 'TV', rows: tv },
    { title: 'Media: native / MSE', rows: mediaRows() },
  ];
}
