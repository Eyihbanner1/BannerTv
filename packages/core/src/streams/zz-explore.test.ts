import { parseStream, type Stream } from '@bannertv/protocol';
import { it } from 'vitest';
import { assessStream } from './assess';
import { describeStream } from './facts';
import fixture from './fixtures/streams.json';
import { orderStreams, playableCandidates, qualityChoices } from './order';
import type { StreamEntry, TvCapabilities } from './types';

const LG_2022: TvCapabilities = {
  webOS: 22, uhd: true, hdr10: true, dolbyVision: false, hevc: true, av1: true, dts: false, truehd: false,
};
const HD: TvCapabilities = { ...LG_2022, uhd: false, hdr10: false };

function build(tv: TvCapabilities): StreamEntry[] {
  const out: StreamEntry[] = [];
  (fixture as any).streams.forEach((raw: any, i: number) => {
    let s = parseStream(raw);
    if (!s && typeof raw.url === 'string') s = parseStream({ ...raw, url: raw.url.replace(/\s/g, '%20') });
    if (!s) return;
    const facts = describeStream(s);
    out.push({ stream: s as Stream, addonId: raw._fixture.id.split('-')[0], addonRank: 0, rank: i, facts, assessment: assessStream(s, facts, tv) });
  });
  return out;
}
const id = (e: StreamEntry) => ((fixture as any).streams[e.rank]._fixture.id as string);
it('explore', () => {
  for (const tv of [LG_2022, HD]) {
    const list = build(tv);
    const lines: string[] = [];
    for (const e of list) {
      const f = e.facts;
      lines.push(`${id(e)} | ${e.assessment.action.kind} | ${e.assessment.warnings.join(',')} | ${f.resolution} ${f.hdr.join('/')} ${f.videoCodec} ${f.audio.join('/')} main=${f.mainAudio} ${f.releaseSource} size=${f.sizeBytes ? (f.sizeBytes / 2 ** 30).toFixed(1) : '-'} cached=${f.cached} ${f.container ?? ''}`);
    }
    console.log(lines.join('\n'));
    for (const o of ['quality', 'fast'] as const) {
      const c = playableCandidates(list, o, tv);
      console.log(o, 'candidates:\n  ' + c.map(id).join('\n  '));
      console.log(o, 'choices:', qualityChoices(c).map((q) => `${q.resolution}=${id(q.entry)}`).join(' ; '));
    }
    console.log('addon order:', orderStreams(list, 'addon', tv).map(id).slice(0, 8).join(', '));
  }
});
