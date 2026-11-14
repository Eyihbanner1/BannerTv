import { describe, expect, it } from 'vitest';
import { alignSubtitles, type LineTiming } from './align';
import {
  AGREEMENT_LIMITS,
  type Agreement,
  type AgreementDecision,
  type AgreementInput,
  createAgreement,
  fileFacts,
  groupKeyOf,
  type PairAnswer,
  videoFacts,
  weightOf,
} from './agreement';
import cases from './fixtures/agreement-cases.json';
import timings from './fixtures/agreement-rainmaker-timings.json';

/** One case of the fixture (see fixtures/README.md). */
interface Case {
  tag: string;
  key: string;
  viewer: string;
  video: { filename: string | null; title: string | null };
  files: Array<{ id: string; lang: string; label?: string; releaseName?: string; lines: number }>;
  read: string[];
  ranked: string[];
  pairs: Array<[string, string, number, number, string]>;
  expected: { how: string; why: string; shown: string; today: string; offset?: number };
}
const CASES = cases as unknown as Case[];
const caseOf = (tag: string) => CASES.find((c) => c.tag === tag)!;

interface Run {
  decision: AgreementDecision;
  reads: string[];
  aligns: Array<[string, string]>;
}

/**
 * Drives the step machine to its decision. `ahead` answers the downloads the
 * way a TV may: up to that many of the files wanted next, the last first.
 */
function drive(
  agreement: Agreement,
  lines: (key: string) => number | null,
  align: (candidate: string, reference: string) => PairAnswer,
  ahead = 0,
): Run {
  const reads: string[] = [];
  const aligns: Array<[string, string]> = [];
  for (let guard = 0; guard < 100_000; guard++) {
    const step = agreement.next();
    if (step.kind === 'done') return { decision: step.decision, reads, aligns };
    if (step.kind === 'read') {
      const keys = ahead > 0 ? agreement.wanted().slice(0, ahead).reverse() : [step.key];
      expect(keys).toContain(step.key);
      for (const key of keys) {
        reads.push(key);
        agreement.read(key, lines(key));
      }
    } else {
      aligns.push([step.candidate, step.reference]);
      agreement.aligned(step.candidate, step.reference, align(step.candidate, step.reference));
    }
  }
  throw new Error('no decision');
}

const inverse = (answer: PairAnswer): PairAnswer => ({
  offset: -answer.offset * answer.rate,
  rate: 1 / answer.rate,
  confidence: answer.confidence,
});

function inputOf(c: Case, extra: Partial<AgreementInput> = {}): AgreementInput {
  return {
    video: videoFacts(c.video.filename ?? undefined, c.video.title ?? undefined),
    language: c.viewer,
    today: c.expected.today,
    ranked: c.ranked,
    files: c.files.map((file) => ({
      key: file.id,
      lang: file.lang,
      label: file.label,
      releaseName: file.releaseName,
    })),
    ...extra,
  };
}

/** The case's pairs as an aligner stand-in that fails on a pair it does not hold, or one asked twice. */
function tableOf(c: Case) {
  const table = new Map<string, PairAnswer>();
  for (const [candidate, reference, offset, rate, confidence] of c.pairs) {
    table.set(`${candidate}|${reference}`, {
      offset,
      rate,
      confidence: confidence as PairAnswer['confidence'],
    });
  }
  const asked = new Set<string>();
  return (candidate: string, reference: string): PairAnswer => {
    const once = [candidate, reference].sort().join('|');
    if (asked.has(once))
      throw new Error(`${c.tag}: asked twice for ${candidate} against ${reference}`);
    asked.add(once);
    const ran = table.get(`${candidate}|${reference}`);
    if (ran) return ran;
    const back = table.get(`${reference}|${candidate}`);
    if (back) return inverse(back);
    throw new Error(`${c.tag}: no pair ${candidate} against ${reference}`);
  };
}

/** What the reference implementation's words say the decision is. */
function expectedOf(c: Case): Record<string, unknown> {
  const { how, why, shown, offset } = c.expected;
  const score = /^score (\d+) vs (\d+)$/.exec(why);
  if (how !== 'today') {
    return {
      state: how,
      show: shown,
      best: Number(score![1]),
      second: Number(score![2]),
      ...(offset === undefined ? {} : { offset: expect.closeTo(offset, 2) }),
    };
  }
  const wider = /^wider read disagrees \(margin (\d+) vs (\d+)\)$/.exec(why);
  if (wider) return { state: 'none', why: { kind: 'wider', best: +wider[1]!, second: +wider[2]! } };
  const apart =
    /^no-service video: family scoring (\d+) is (-?[\d.]+) s \/ rate ([\d.]+) from/.exec(why);
  if (apart) {
    return {
      state: 'none',
      why: {
        kind: 'apart',
        score: +apart[1]!,
        offset: expect.closeTo(+apart[2]!, 1),
        rate: expect.closeTo(+apart[3]!, 4),
      },
    };
  }
  throw new Error(`${c.tag}: words not known: ${why}`);
}

describe('createAgreement on the fixture cases', () => {
  for (const c of CASES) {
    it(`${c.tag}: ${c.expected.how}, ${c.expected.why}`, () => {
      const lines = new Map(c.files.map((file) => [file.id, file.lines]));
      const run = drive(createAgreement(inputOf(c)), (key) => lines.get(key) ?? null, tableOf(c));
      expect(run.reads).toEqual(c.read);
      expect(run.aligns).toEqual(c.pairs.map(([candidate, reference]) => [candidate, reference]));
      expect(run.decision).toMatchObject({
        ...expectedOf(c),
        read: c.read.length,
        aligned: c.pairs.length,
      });
    });
  }

  it('comes to the same decision however the downloads arrive', () => {
    for (const c of CASES) {
      const lines = new Map(c.files.map((file) => [file.id, file.lines]));
      const inOrder = drive(
        createAgreement(inputOf(c)),
        (key) => lines.get(key) ?? null,
        tableOf(c),
      );
      const ahead = drive(
        createAgreement(inputOf(c)),
        (key) => lines.get(key) ?? null,
        tableOf(c),
        4,
      );
      expect(ahead.decision, c.tag).toEqual(inOrder.decision);
      expect(ahead.aligns, c.tag).toEqual(inOrder.aligns);
    }
  });
});

/** The fixture's timings: `[gap from the previous end, duration, …]` in hundredths of a second. */
function decode(deltas: readonly number[]): LineTiming[] {
  const lines: LineTiming[] = [];
  let t = 0;
  for (let i = 0; i + 1 < deltas.length; i += 2) {
    const start = t + deltas[i]!;
    const end = start + deltas[i + 1]!;
    lines.push({ start: start / 100, end: end / 100 });
    t = end;
  }
  return lines;
}

function realRun(tag: string, extra: Partial<AgreementInput> = {}): Run {
  const c = caseOf(tag);
  const files = (timings as Record<string, Record<string, number[]>>)[c.key]!;
  const lines = new Map(Object.keys(files).map((id) => [id, decode(files[id]!)]));
  return drive(
    createAgreement(inputOf(c, extra)),
    (key) => lines.get(key)?.length ?? null,
    (candidate, reference) => alignSubtitles(lines.get(candidate)!, lines.get(reference)!),
  );
}

describe('createAgreement with the aligner on real timings', () => {
  it('moves E6 WEB.REAL onto the AMZN files rather than keeping it', () => {
    const { decision } = realRun('RM-E6');
    expect(decision).toMatchObject({
      state: 'moved',
      show: '13283587',
      leader: '13283717',
      best: 9,
      second: 3,
      service: 'amzn',
      wider: true,
      read: 28,
      aligned: 176,
    });
    expect(decision.state === 'moved' && decision.offset).toBeCloseTo(-8.73, 1);
  });

  it('switches E6 to the leader when the file showing is not moved first', () => {
    const { decision } = realRun('RM-E6', { moveFirst: false });
    expect(decision).toMatchObject({ state: 'switched', show: '13283717', leader: '13283717' });
  });

  it('keeps the E5 WEB file, with no wider read', () => {
    const { decision } = realRun('RM-E5');
    expect(decision).toMatchObject({
      state: 'kept',
      show: '13260775',
      best: 7,
      second: 3,
      wider: false,
      read: 12,
      aligned: 46,
    });
  });
});

// Hand-built cases: names say the facts, and each file sits `at` seconds from
// the video (its lines at video time × `rate` + `at`); a file with no `at`
// lines up with nothing.
interface Made {
  key: string;
  lang?: string;
  name: string;
  at?: number;
  rate?: number;
  lines?: number | null;
}

const WEB = 'Show.S01E01.1080p.WEB.h264';
const AMZN = 'Show.S01E01.1080p.AMZN.WEB-DL.DDP5.1.H.264';
const NAMES = {
  amznVideo: `${AMZN}-GRP.mkv`,
  webVideo: `${WEB}-GRP.mkv`,
};

function made(
  video: string,
  files: readonly Made[],
  extra: Partial<AgreementInput> & { pairs?: Record<string, PairAnswer> } = {},
  ahead = 0,
): Run {
  const byKey = new Map(files.map((file) => [file.key, file]));
  const { pairs = {}, ...rest } = extra;
  const own = files.filter((file) => (file.lang ?? 'en') === 'en').map((file) => file.key);
  const input: AgreementInput = {
    video: videoFacts(video),
    language: 'en',
    today: own[0]!,
    ranked: own,
    files: files.map((file) => ({ key: file.key, lang: file.lang ?? 'en', label: file.name })),
    ...rest,
  };
  const asked = new Set<string>();
  return drive(
    createAgreement(input),
    (key) => {
      const lines = byKey.get(key)!.lines;
      return lines === undefined ? 500 : lines;
    },
    (candidate, reference) => {
      const once = [candidate, reference].sort().join('|');
      if (asked.has(once)) throw new Error(`asked twice: ${once}`);
      asked.add(once);
      const set = pairs[`${candidate}|${reference}`];
      if (set) return set;
      const back = pairs[`${reference}|${candidate}`];
      if (back) return inverse(back);
      const c = byKey.get(candidate)!;
      const r = byKey.get(reference)!;
      if (c.at === undefined || r.at === undefined)
        return { offset: 0, rate: 1, confidence: 'none' };
      const kc = c.rate ?? 1;
      const kr = r.rate ?? 1;
      return { offset: r.at - (c.at * kr) / kc, rate: kc / kr, confidence: 'sure' };
    },
    ahead,
  );
}

/** Files of distinct releases, `count` of them, from `from`: other languages unless told. */
function releases(
  prefix: string,
  count: number,
  shape: Partial<Made> & { base?: string } = {},
): Made[] {
  const { base = WEB, ...rest } = shape;
  return Array.from({ length: count }, (_, n) => ({
    key: `${prefix}${n}`,
    lang: 'fr',
    name: `${base}-R${prefix.toUpperCase()}${n}.srt`,
    at: 0,
    ...rest,
  }));
}

describe('createAgreement decides', () => {
  it('not to try a cinema recording, or a video naming no source', () => {
    const files: Made[] = [{ key: 'a', name: `${WEB}-ETHEL.srt`, at: 0 }];
    expect(made('Show.2019.HDCAM.x264-GRP.mkv', files).decision).toEqual({
      state: 'not tried',
      why: 'recording',
      read: 0,
      aligned: 0,
    });
    expect(made('Show.2019.HDTS.x264-GRP.mkv', files).decision).toMatchObject({
      why: 'recording',
    });
    expect(made('Show.S01E01.mkv', files).decision).toMatchObject({
      state: 'not tried',
      why: 'no source',
    });
  });

  it('nothing when the best scores under 3', () => {
    const files: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 0 },
      { key: 'b', name: `${WEB}-CAKES.srt`, at: 0 },
      { key: 'c', name: 'Show S01E01.srt', at: 4 },
    ];
    expect(made(NAMES.webVideo, files).decision).toMatchObject({
      state: 'none',
      why: { kind: 'under', best: 2 },
    });
  });

  it('nothing when the next is too close, or level', () => {
    // 4 against 3: one AMZN file and one plain file, against one AMZN file.
    const close: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 0 },
      { key: 'b', name: `${AMZN}-NTb.srt`, at: 0 },
      { key: 'c', name: `${AMZN}-FLUX.srt`, at: 6 },
    ];
    expect(made(NAMES.amznVideo, close).decision).toMatchObject({
      state: 'none',
      why: { kind: 'close', best: 4, second: 3 },
    });
    const level: Made[] = [
      { key: 'a', name: `${AMZN}-NTb.srt`, at: 0 },
      { key: 'b', name: `${AMZN}-FLUX.srt`, at: 6 },
    ];
    expect(made(NAMES.amznVideo, level).decision).toMatchObject({
      state: 'none',
      why: { kind: 'close', best: 3, second: 3 },
    });
  });

  it('nothing on a video naming no service when a scoring group is not lined up with the winner', () => {
    const files: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 0 },
      ...releases('w', 3),
      { key: 'x', lang: 'de', name: `${WEB}-LONE.srt` },
    ];
    expect(made(NAMES.webVideo, files).decision).toMatchObject({
      state: 'none',
      why: { kind: 'unlinked', score: 1 },
    });
  });

  it('nothing on a video naming no service when a scoring group is 1.6 s from the winner, not 1.4 s', () => {
    const files = (at: number): Made[] => [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 0 },
      ...releases('w', 3),
      { key: 'x', lang: 'de', name: `${WEB}-APART.srt`, at },
    ];
    expect(made(NAMES.webVideo, files(1.6)).decision).toMatchObject({
      state: 'none',
      why: { kind: 'apart', score: 1, offset: expect.closeTo(-1.6, 6), rate: 1 },
    });
    expect(made(NAMES.webVideo, files(1.4)).decision).toMatchObject({
      state: 'kept',
      show: 'a',
      best: 4,
      second: 1,
    });
  });

  it('nothing when the file showing is timed for another frame rate: the drift checks see to it', () => {
    const files: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 2, rate: 25 / 23.976 },
      { key: 'b', name: `${AMZN}-NTb.srt`, at: 0 },
      { key: 'c', lang: 'fr', name: `${AMZN}-FLUX.srt`, at: 0 },
    ];
    expect(made(NAMES.amznVideo, files).decision).toMatchObject({
      state: 'none',
      why: { kind: 'rate' },
    });
  });

  it('nothing when the video names an edition none of the winner names', () => {
    const files: Made[] = [
      { key: 'a', name: `${AMZN}-NTb.srt`, at: 0 },
      { key: 'b', lang: 'fr', name: `${AMZN}-FLUX.srt`, at: 0 },
    ];
    const extended = 'Show.2019.EXTENDED.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP.mkv';
    expect(made(extended, files).decision).toMatchObject({
      state: 'none',
      why: { kind: 'edition', edition: 'extended' },
    });
    const named = files.concat({
      key: 'c',
      lang: 'de',
      name: 'Show.2019.Extended.1080p.WEB.h264-ETHEL.srt',
      at: 0,
    });
    expect(made(extended, named).decision).toMatchObject({ state: 'kept' });
  });

  // Stage 1: the file showing (3 s out) and a plain file, two AMZN files in
  // step with each other, and eight languages of the file showing's release.
  const stage1: Made[] = [
    { key: 'a', name: `${WEB}-ETHEL.srt`, at: 3 },
    { key: 'b', name: 'Show S01E01.srt', at: 3 },
    { key: 'n', name: `${AMZN}-NTb.srt`, at: 0 },
    { key: 'f', name: `${AMZN}-FLUX.srt`, at: 0 },
    ...Array.from({ length: 8 }, (_, n) => ({
      key: `e${n}`,
      lang: `l${n}`,
      name: `${WEB}-ETHEL.srt`,
      at: 3,
    })),
  ];

  it('nothing when the wider read finds a winner sharing no file with the first', () => {
    const files = stage1.concat(releases('s', 9, { at: 10 }));
    const run = made(NAMES.amznVideo, files);
    expect(run.decision).toMatchObject({
      state: 'none',
      why: { kind: 'wider', best: 9, second: 6 },
      read: 21,
    });
  });

  it('to move the file showing when the wider read agrees, on the first winner as it stood', () => {
    const run = made(NAMES.amznVideo, stage1.concat(releases('s', 3)));
    expect(run.decision).toMatchObject({
      state: 'moved',
      show: 'a',
      leader: 'n',
      offset: -3,
      within: ['n', 'f'],
      best: 6,
      second: 1,
      service: 'amzn',
      wider: true,
      read: 15,
    });
  });

  it('to give up after 100 files, 1,000 alignments or 120 s', () => {
    // 1 file showing 3 s out, then 120 AMZN files in step: stage 2 reads on to the limit.
    const many: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 3 },
      ...releases('m', 120, { base: AMZN }),
    ];
    expect(made(NAMES.amznVideo, many).decision).toMatchObject({
      state: 'none',
      why: { kind: 'gave up', after: 'files' },
      read: AGREEMENT_LIMITS.files,
    });
    // Files lined up with none of the rest each start a group, and each later file is lined up against them all.
    const lone: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 3 },
      ...releases('m', 11, { base: AMZN }),
      ...releases('x', 80, { at: undefined }),
    ];
    expect(made(NAMES.amznVideo, lone).decision).toMatchObject({
      state: 'none',
      why: { kind: 'gave up', after: 'aligned' },
      aligned: AGREEMENT_LIMITS.aligned,
    });
    let clock = 0;
    const slow = made(NAMES.amznVideo, many, { now: () => (clock += 7_000) });
    expect(slow.decision).toMatchObject({ state: 'none', why: { kind: 'gave up', after: 'time' } });
    expect(slow.decision.read).toBeLessThan(20);
  });

  it('on 12 usable files, unusable ones not counted, and after 20 downloads on fewer', () => {
    const spoiled = (count: number): Made[] => [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 0 },
      ...releases('u', count, { lines: null }),
      ...releases('w', 3, { lines: 30 }),
      ...releases('k', 30),
    ];
    const five = made(NAMES.webVideo, spoiled(2));
    // The file showing, 2 unreadable, 3 too short, then 11 more to make 12.
    expect(five.reads).toHaveLength(17);
    expect(five.decision).toMatchObject({ state: 'kept', read: 17, best: 12 });
    const many = made(NAMES.webVideo, spoiled(17));
    // 20 downloads: the file showing, 17 unreadable, 2 too short: 1 usable file.
    expect(many.reads).toHaveLength(20);
    expect(many.decision).toMatchObject({ state: 'none', why: { kind: 'under', best: 1 } });
  });

  it('the same, files answered ahead and in reverse', () => {
    const files = stage1.concat(releases('s', 3), releases('t', 2, { lines: null }));
    expect(made(NAMES.amznVideo, files, {}, 4).decision).toEqual(
      made(NAMES.amznVideo, files).decision,
    );
  });
});

describe('createAgreement shows', () => {
  // The file showing 'a' (8 s out), then the winner: an AMZN file in English
  // ('n', the leader), an AMZN file in French, and an English file in step.
  const base: Made[] = [
    { key: 'a', name: `${WEB}-ETHEL.srt`, at: 8 },
    { key: 'n', name: `${AMZN}-NTb.srt`, at: 0 },
    { key: 'f', lang: 'fr', name: `${AMZN}-FLUX.srt`, at: 0 },
    { key: 'k', name: `${AMZN}-KiNGS.srt`, at: 0.2 },
  ];
  const unsure: PairAnswer = { offset: 5, rate: 1, confidence: 'unsure' };

  it('the file showing moved by its pair with the leader', () => {
    expect(made(NAMES.amznVideo, base).decision).toMatchObject({
      state: 'moved',
      show: 'a',
      leader: 'n',
      offset: -8,
      within: ['n', 'f', 'k'],
    });
  });

  it('a file of the winner instead, when the move comes second or there is no sure pair', () => {
    expect(made(NAMES.amznVideo, base, { moveFirst: false }).decision).toMatchObject({
      state: 'switched',
      show: 'n',
      offset: 0,
    });
    // No sure pair with a French leader: the English file of it the planner ranks best shows.
    const french: Made[] = [
      { key: 'a', name: `${WEB}-ETHEL.srt`, at: 8 },
      { key: 'b', name: 'Show S01E01.srt' },
      { key: 'n', lang: 'fr', name: `${AMZN}-NTb.srt`, at: 0 },
      { key: 'f', lang: 'fr', name: `${AMZN}-FLUX.srt`, at: 0 },
      { key: 'j', name: `${AMZN}-JETIX.srt`, at: 0.1 },
      { key: 'k', name: `${AMZN}-KiNGS.srt`, at: 0.2 },
    ];
    const ranked = ['a', 'b', 'k', 'j'];
    expect(
      made(NAMES.amznVideo, french, { pairs: { 'a|n': unsure }, ranked }).decision,
    ).toMatchObject({
      state: 'switched',
      show: 'k',
      leader: 'n',
      offset: expect.closeTo(-0.2, 6),
      within: ['n', 'f', 'j', 'k'],
    });
  });

  it('the file showing shifted by its place in the winner, when no other may show', () => {
    expect(
      made(NAMES.amznVideo, base, { pairs: { 'a|n': unsure }, canSwitch: () => false }).decision,
    ).toMatchObject({ state: 'shifted', show: 'a', offset: expect.closeTo(-7.8, 6) });
    // With a sure pair the move still comes first.
    expect(made(NAMES.amznVideo, base, { canSwitch: () => false }).decision).toMatchObject({
      state: 'moved',
      offset: -8,
    });
  });

  it('nothing when the file showing lines up with none of the winner and none may show', () => {
    const pairs = { 'f|a': unsure, 'k|a': unsure, 'n|a': unsure };
    expect(made(NAMES.amznVideo, base, { pairs, canSwitch: () => false }).decision).toMatchObject({
      state: 'none',
      why: { kind: 'unmatched', best: 9, second: 1 },
    });
    // None of the winner's in English to show: the same.
    const french = base.map((file) =>
      file.key === 'k' || file.key === 'n' ? { ...file, lang: 'fr' } : file,
    );
    expect(made(NAMES.amznVideo, french, { pairs }).decision).toMatchObject({
      state: 'none',
      why: { kind: 'unmatched' },
    });
  });

  it('the file showing as it is when it is in the winner', () => {
    const files: Made[] = [
      { key: 'a', name: `${AMZN}-NTb.srt`, at: 0.3 },
      { key: 'f', lang: 'fr', name: `${AMZN}-FLUX.srt`, at: 0 },
    ];
    expect(made(NAMES.amznVideo, files).decision).toMatchObject({
      state: 'kept',
      show: 'a',
      leader: 'a',
      offset: 0,
      wider: false,
    });
  });
});

describe('agreement facts', () => {
  it('gives one key to a pack of 25 languages from one release', () => {
    const tags = ['en', 'fr', 'de', 'es', 'it', 'pt', 'pt-BR', 'nl', 'sv', 'da', 'no', 'fi', 'pl'];
    const more = ['cs', 'hu', 'ro', 'el', 'tr', 'ar', 'he', 'ru', 'uk', 'ja', 'ko', 'zh'];
    const names = tags.concat(more).map((tag, n) => {
      const base = 'Show.S01E01.1080p.WEB.h264';
      return n % 3 === 0
        ? `${base}.${tag}.srt`
        : n % 3 === 1
          ? `${base}_[${tag}].srt`
          : `${base} (${tag}).srt`;
    });
    expect(names).toHaveLength(25);
    expect(new Set(names.map((name) => groupKeyOf({ label: name })))).toEqual(
      new Set(['r:shows01e011080pwebh264']),
    );
    const grouped = tags.map((tag) =>
      groupKeyOf({ label: `Show.S01E01.WEB.h264-ETHEL.${tag}.srt` }),
    );
    expect(new Set(grouped)).toEqual(new Set(['g:ethel']));
    expect(groupKeyOf({ label: 'Show S01E01 [eng].srt' })).toBe(
      groupKeyOf({ label: 'Show S01E01.fr.srt' }),
    );
  });

  it('weighs a file by what its names say against the video', () => {
    const amzn = videoFacts(NAMES.amznVideo);
    const web = videoFacts(NAMES.webVideo);
    const weight = (video: typeof amzn, name: string) => weightOf(video, fileFacts(name));
    expect(weight(amzn, 'Show.S01E01.1080p.BluRay.x264-SPARKS.srt')).toBeNull();
    expect(weight(amzn, 'Show.S01E01.HDTV.x264-KILLERS.srt')).toBeNull();
    expect(weight(amzn, `${AMZN}-FLUX.srt`)).toBe(3);
    expect(weight(amzn, 'Show.S01E01.1080p.NF.WEB-DL.DDP5.1.H.264-FLUX.srt')).toBe(0);
    expect(weight(amzn, `${WEB}-ETHEL.srt`)).toBe(1);
    expect(weight(amzn, 'Show S01E01.srt')).toBe(0);
    expect(weight(web, `${AMZN}-FLUX.srt`)).toBe(1);
    expect(weight(web, `${WEB}-ETHEL.srt`)).toBe(1);
    expect(weight(web, 'Show S01E01.srt')).toBe(0);
    // The second name fills what the file's own leaves out.
    expect(weightOf(amzn, fileFacts('Show S01E01.srt', 'Show.S01E01.AMZN.WEB-DL-NTb'))).toBe(3);
  });

  it('reads the video from its file name first, the title filling the rest', () => {
    expect(videoFacts('Show.S01E01.mkv', 'Show S01E01 1080p AMZN WEB-DL')).toMatchObject({
      source: 'web',
      service: 'amzn',
    });
    expect(videoFacts('Show.S01E01.BluRay.mkv', 'Show S01E01 WEB-DL')).toMatchObject({
      source: 'bluray',
    });
  });
});
