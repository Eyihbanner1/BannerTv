import { guessMimeType } from './media';

export interface LabSource {
  label: string;
  url: string;
  /** What the source is for, shown under its name. */
  note?: string;
}

/**
 * Public test streams. Only legal, freely licensed media.
 * HEVC HDR10 and Dolby Vision files are not freely hosted anywhere reliable,
 * so those come from lab-sources.local.json (see docs/TV_SETUP.md).
 */
const PRESETS: LabSource[] = [
  {
    label: 'MKV, 2 audio + 8 subtitle tracks',
    note: 'Spike 2 · Matroska test suite, test5 (Elephants Dream, CC BY)',
    url: 'https://raw.githubusercontent.com/ietf-wg-cellar/matroska-test-files/master/test_files/test5.mkv',
  },
  {
    label: 'HLS, alternate audio and subtitles',
    note: 'Spike 2 · Apple bipbop advanced example',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
  },
  {
    label: 'MP4, H.264 1080p, 10 minutes',
    note: 'Spike 3 start position · Big Buck Bunny (CC BY, Blender)',
    url: 'https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4',
  },
];

// Optional personal list, never committed. Missing file means an empty list.
const local = import.meta.glob<LabSource[]>('../../lab-sources.local.json', {
  eager: true,
  import: 'default',
});

const localSources: LabSource[] = [];
for (const list of Object.values(local)) {
  if (!Array.isArray(list)) continue;
  for (const source of list) {
    if (typeof source?.url !== 'string') continue;
    localSources.push({ ...source, note: source.note ?? `Local · ${guessMimeType(source.url)}` });
  }
}

export const LAB_SOURCES: readonly LabSource[] = [...PRESETS, ...localSources];
