import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Tuning, TUNING_DEFAULTS } from '../platform/tuning';

/**
 * Decoding ahead against a small stand-in for the page: a stack of rows of
 * tiles, frames run by hand, and a remote that has been still for as long
 * as a test says. The vitest environment has no DOM.
 */

const page = vi.hoisted(() => ({
  tuning: {} as Record<string, unknown>,
  stillFor: 1000,
  marks: [] as string[],
}));

vi.mock('../platform/tuning', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tuning: page.tuning,
}));
vi.mock('../navigation/activity', () => ({ sinceActivity: () => page.stillFor }));
vi.mock('../platform/marks', () => ({ mark: (name: string) => page.marks.push(name) }));

class FakeElement {
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  className = '';
  style = { cssText: '' };
  listeners: string[] = [];
  /** Where it is on the screen: the box under the rail is 1 px, in a page scaled by 1. */
  rect = { left: 0, right: 1, top: 0, bottom: 1, width: 1, height: 1 };
  private attributes = new Map<string, string>();

  constructor(attributes: Record<string, string> = {}) {
    for (const name of Object.keys(attributes)) this.attributes.set(name, attributes[name]!);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild<T extends FakeElement>(child: T): T {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  get nextElementSibling(): FakeElement | null {
    const siblings = this.parentNode?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling(): FakeElement | null {
    const siblings = this.parentNode?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  /** Rows are siblings: FOLLOWING when `other` comes after this one. */
  compareDocumentPosition(other: FakeElement) {
    const siblings = this.parentNode?.children ?? [];
    return siblings.indexOf(other) > siblings.indexOf(this) ? 4 : 2;
  }
  contains(node: FakeElement | null) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  getElementsByTagName() {
    const found: FakeImage[] = [];
    const walk = (element: FakeElement) => {
      for (const child of element.children) {
        if (child instanceof FakeImage) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector: string): FakeElement | null {
    const key = /^\[data-row-key="(.*)"\]$/.exec(selector)?.[1];
    let match: FakeElement | null = null;
    const walk = (element: FakeElement) => {
      for (const child of element.children) {
        if (!match && child.getAttribute('data-row-key') === key) match = child;
        walk(child);
      }
    };
    walk(this);
    return match;
  }
  addEventListener(type: string) {
    this.listeners.push(type);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

class FakeImage extends FakeElement {
  complete = true;
  naturalWidth = 0;
  naturalHeight = 0;
  src = '';
  alt = 'x';
  draggable = true;
  objectFit = 'fill';
  override rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  /** Each decode() asked, settled by the test. */
  static decodes: { image: FakeImage; settle: () => void }[] = [];

  decode() {
    return new Promise<void>((resolve) => FakeImage.decodes.push({ image: this, settle: resolve }));
  }
}

interface Art {
  src: string;
  natural: [number, number];
  /** Where it is drawn, in CSS px: left, width, height. */
  drawn: [number, number, number];
  className?: string;
  objectFit?: string;
}

function image({ src, natural, drawn, className = 'image', objectFit = 'cover' }: Art): FakeImage {
  const element = new FakeImage();
  element.src = src;
  element.className = className;
  element.objectFit = objectFit;
  [element.naturalWidth, element.naturalHeight] = natural;
  const [left, width, height] = drawn;
  element.rect = { left, right: left + width, top: 0, bottom: height, width, height };
  return element;
}

/**
 * A row of posters 500x750 drawn at 220x330: `across` of them on the screen
 * from x 184, and two more drawn past its right edge.
 */
function posterRow(key: string, across = 7): FakeElement {
  const row = new FakeElement({ 'data-row-key': key });
  for (let n = 0; n < across + 2; n++) {
    const left = n < across ? 184 + n * 244 : 1920 + (n - across) * 244;
    const tile = row.appendChild(new FakeElement());
    tile.appendChild(
      image({
        src: `https://art/poster/${key}/${n}`,
        natural: [500, 750],
        drawn: [left, 220, 330],
      }),
    );
  }
  return row;
}

/** A Featured row: wide art 1920x1080 at 384x216, and a 500x150 logo at 238x71.4 on each. */
function featuredRow(key: string, backdrop: [number, number] = [1920, 1080]): FakeElement {
  const row = new FakeElement({ 'data-row-key': key });
  for (let n = 0; n < 7; n++) {
    const left = 184 + n * 408;
    const tile = row.appendChild(new FakeElement());
    tile.appendChild(
      image({
        src: `https://art/background/${key}/${n}`,
        natural: backdrop,
        drawn: [left, 384, 216],
      }),
    );
    tile.appendChild(
      image({
        src: `https://art/logo/${key}/${n}`,
        natural: [500, 150],
        drawn: [left + 20, 238, 71.4],
        className: 'logo',
        objectFit: 'contain',
      }),
    );
  }
  return row;
}

let frames: ((time: number) => void)[] = [];
let time = 1000;
let root: FakeElement;

/** Runs `count` animation frames, `gap` ms apart. */
function runFrames(count: number, gap = 16): void {
  for (let n = 0; n < count; n++) {
    time += gap;
    const due = frames;
    frames = [];
    for (const callback of due) callback(time);
  }
}

async function settleDecodes(): Promise<void> {
  for (const { settle } of FakeImage.decodes.splice(0)) settle();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type Module = typeof import('./decode-ahead');

async function load(tuning: Partial<Tuning> = {}): Promise<Module> {
  for (const key of Object.keys(page.tuning)) delete page.tuning[key];
  Object.assign(page.tuning, TUNING_DEFAULTS, tuning);
  vi.resetModules();
  return import('./decode-ahead');
}

/** The stack Home slides: rows top down, in a track. */
function stack(...rows: FakeElement[]): { track: FakeElement; rows: FakeElement[] } {
  const track = root.appendChild(new FakeElement());
  for (const row of rows) track.appendChild(row);
  return { track, rows };
}

const slide = (module: Module, track: FakeElement, row: FakeElement | null) =>
  module.decodeAheadOf(track as unknown as HTMLElement, row as unknown as HTMLElement);

const srcs = (element: FakeElement) => element.children.map((child) => (child as FakeImage).src);
const decodedSrcs = () => FakeImage.decodes.map(({ image }) => image.src);

beforeEach(() => {
  frames = [];
  time = 1000;
  page.stillFor = 1000;
  page.marks.length = 0;
  FakeImage.decodes = [];
  root = new FakeElement();
  let ids = 0;
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLImageElement', FakeImage);
  // A class, as vitest's matchers look for DOM nodes with instanceof.
  vi.stubGlobal(
    'Node',
    class {
      static DOCUMENT_POSITION_FOLLOWING = 4;
    },
  );
  vi.stubGlobal('window', { innerWidth: 1920, devicePixelRatio: 2 });
  vi.stubGlobal('getComputedStyle', (element: FakeImage) => ({ objectFit: element.objectFit }));
  vi.stubGlobal('document', {
    querySelector: (selector: string) => root.querySelector(selector),
    createElement: () => new FakeImage(),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
    frames.push(callback);
    return ++ids;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decoding ahead (aheadMode decode, the default)', () => {
  it('decodes the row after next one image at a time, leaving out wide art', async () => {
    const ahead = await load();
    expect(ahead.RASTER_AHEAD).toBe(false);
    const { track, rows } = stack(posterRow('a'), posterRow('b'), featuredRow('c'));
    slide(ahead, track, rows[0]!);
    expect(track.listeners).toEqual(['load']);
    runFrames(5);
    // Only the logos: 1920 art drawn at 768 device px is more than 1.5 times its size.
    expect(decodedSrcs()).toEqual(['https://art/logo/c/0']);
    for (let n = 0; n < 6; n++) {
      await settleDecodes();
      runFrames(3);
    }
    expect(page.marks.filter((name) => name === 'ahead:c')).toHaveLength(5);
    expect(page.marks.filter((name) => name === 'ahead-done:c')).toHaveLength(5);
  });

  it('starts nothing while the remote is in use', async () => {
    const ahead = await load();
    const { track, rows } = stack(posterRow('a'), posterRow('b'), posterRow('c'));
    page.stillFor = 50;
    slide(ahead, track, rows[0]!);
    runFrames(10);
    expect(FakeImage.decodes).toEqual([]);
    page.stillFor = 1000;
    runFrames(1);
    expect(decodedSrcs()).toEqual(['https://art/poster/c/0']);
  });

  it('never draws under the rail, even given a box', async () => {
    const ahead = await load();
    const box = new FakeElement();
    ahead.warmBoxRef(box as unknown as HTMLElement);
    const { track, rows } = stack(posterRow('a'), posterRow('b'), posterRow('c'));
    slide(ahead, track, rows[0]!);
    runFrames(5);
    expect(box.children).toEqual([]);
    expect(FakeImage.decodes).toHaveLength(1);
  });
});

describe('aheadMode raster', () => {
  async function raster(tuning: Partial<Tuning> = {}) {
    const ahead = await load({ aheadMode: 'raster', ...tuning });
    const box = new FakeElement();
    ahead.warmBoxRef(box as unknown as HTMLElement);
    return { ahead, box };
  }

  it('draws each image once under the rail at its drawn size, wide art too, and decodes none', async () => {
    const { ahead, box } = await raster();
    expect(ahead.RASTER_AHEAD).toBe(true);
    const { track, rows } = stack(posterRow('a'), posterRow('b'), featuredRow('c'));
    slide(ahead, track, rows[0]!);
    runFrames(3);
    expect(srcs(box)).toEqual(['https://art/background/c/0']);
    const [wide] = box.children as FakeImage[];
    expect(wide!.className).toBe('image');
    expect(wide!.alt).toBe('');
    expect(wide!.draggable).toBe(false);
    expect(wide!.style.cssText).toContain('width:384px;height:216px;');
    expect(wide!.style.cssText).toContain('max-width:none;max-height:none');
    runFrames(20);
    // Five tiles across the screen (the fifth shows a strip), wide art and logo each.
    const across: string[] = [];
    for (let n = 0; n < 5; n++) {
      across.push(`https://art/background/c/${n}`, `https://art/logo/c/${n}`);
    }
    expect(srcs(box)).toEqual(across);
    const logo = box.children[1] as FakeImage;
    expect(logo.className).toBe('logo');
    expect(logo.style.cssText).toContain('width:238px;height:71.4px;');
    expect(FakeImage.decodes).toEqual([]);
    expect(page.marks.slice(0, 4)).toEqual(['ahead:c', 'ahead-done:c', 'ahead:c', 'ahead-done:c']);
  });

  it('sizes the copy in the page’s own px when the page is scaled down to fit the window', async () => {
    const { ahead, box } = await raster();
    // A 1080p Android TV's WebView: the page at half size, so the box is half a px on the screen.
    box.rect = { left: 0, right: 0.5, top: 539.5, bottom: 540, width: 0.5, height: 0.5 };
    const row = new FakeElement({ 'data-row-key': 'c' });
    row.appendChild(new FakeElement()).appendChild(
      image({
        src: 'https://art/background/c/0',
        natural: [1920, 1080],
        drawn: [92, 192, 108],
      }),
    );
    const { track, rows } = stack(posterRow('a', 2), posterRow('b', 2), row);
    slide(ahead, track, rows[0]!);
    runFrames(3);
    const [wide] = box.children as FakeImage[];
    expect(wide!.style.cssText).toContain('width:384px;height:216px;');
  });

  it('waits for two flowing frames after each image, and for a still remote', async () => {
    const { ahead, box } = await raster();
    const { track, rows } = stack(posterRow('a'), posterRow('b'), posterRow('c'));
    slide(ahead, track, rows[0]!);
    runFrames(3);
    expect(box.children).toHaveLength(1);
    runFrames(1);
    expect(box.children).toHaveLength(1);
    runFrames(1);
    expect(box.children).toHaveLength(2);
    // A long frame: the drawing is not done until two flow after it.
    runFrames(1, 80);
    runFrames(1);
    expect(box.children).toHaveLength(2);
    runFrames(1);
    expect(box.children).toHaveLength(3);
    page.stillFor = 50;
    runFrames(10);
    expect(box.children).toHaveLength(3);
  });

  it('keeps at most ten drawn, the newest', async () => {
    const { ahead, box } = await raster();
    const { track, rows } = stack(posterRow('a'), posterRow('b'), posterRow('c'), posterRow('d'));
    // Down to b, which takes d; then Up to a, which has no row above and takes c.
    slide(ahead, track, rows[1]!);
    runFrames(40);
    expect(srcs(box)).toEqual([0, 1, 2, 3, 4, 5, 6].map((n) => `https://art/poster/d/${n}`));
    slide(ahead, track, rows[0]!);
    runFrames(40);
    expect(box.children).toHaveLength(ahead.MAX_WARM);
    expect(srcs(box)).toEqual([
      ...[4, 5, 6].map((n) => `https://art/poster/d/${n}`),
      ...[0, 1, 2, 3, 4, 5, 6].map((n) => `https://art/poster/c/${n}`),
    ]);
  });

  it('lets art go once the view has moved on past the row it was drawn for', async () => {
    const { ahead, box } = await raster();
    const { track, rows } = stack(
      posterRow('a', 2),
      posterRow('b', 2),
      posterRow('c', 2),
      posterRow('d', 2),
      posterRow('e', 2),
    );
    slide(ahead, track, rows[0]!);
    runFrames(20);
    expect(srcs(box)).toEqual(['https://art/poster/c/0', 'https://art/poster/c/1']);
    // The Down that shows c keeps its art drawn...
    slide(ahead, track, rows[1]!);
    expect(box.children).toHaveLength(2);
    runFrames(20);
    expect(box.children).toHaveLength(4);
    // ...and the next lets it go.
    slide(ahead, track, rows[2]!);
    expect(srcs(box)).toEqual(['https://art/poster/d/0', 'https://art/poster/d/1']);
  });

  it('draws nothing while the rail, and so the box, is not drawn, and carries on once it is', async () => {
    const { ahead, box } = await raster();
    const { track, rows } = stack(posterRow('a', 2), posterRow('b', 2), posterRow('c', 2));
    slide(ahead, track, rows[0]!);
    runFrames(3);
    expect(box.children).toHaveLength(1);
    // The player opens: React takes the box out of the page with its art.
    ahead.warmBoxRef(null);
    runFrames(20);
    expect(frames).toEqual([]);
    const again = new FakeElement();
    ahead.warmBoxRef(again as unknown as HTMLElement);
    runFrames(5);
    expect(srcs(again)).toEqual(['https://art/poster/c/1']);
    expect(box.children).toHaveLength(1);
  });
});

describe('aheadOversize', () => {
  const size = (width: number, height: number) => ({ width, height });

  it('at 1.5, the default, takes art up to 1.5 times its drawn width, whatever its height', async () => {
    const { worthDecodingAt } = await load();
    expect(worthDecodingAt(size(1152, 9999), size(768, 432), 1.5, false)).toBe(true);
    expect(worthDecodingAt(size(1153, 1), size(768, 432), 1.5, false)).toBe(false);
    // Cropping makes no difference to it.
    expect(worthDecodingAt(size(1920, 1200), size(768, 432), 1.5, true)).toBe(false);
  });

  it('at 2, leaves out only art whose half-size copy still covers its drawn size both ways', async () => {
    const { worthDecodingAt } = await load();
    // Metahub's wide art on a wide tile, 768x432 device px: drawn from a 960x540 copy.
    expect(worthDecodingAt(size(1920, 1080), size(768, 432), 2, false)).toBe(false);
    // Its smaller medium art, 1.67 times as wide: drawn at full size, so decoded ahead.
    expect(worthDecodingAt(size(1280, 720), size(768, 432), 2, false)).toBe(true);
    // Half rounds up: 1535 halves to 768, which covers 768; 1534 halves to 767, which does not.
    expect(worthDecodingAt(size(1535, 864), size(768, 432), 2, false)).toBe(false);
    expect(worthDecodingAt(size(1534, 864), size(768, 432), 2, false)).toBe(true);
    // Either way short is enough, and the drawn size rounds up too.
    expect(worthDecodingAt(size(4000, 862), size(768, 432), 2, false)).toBe(true);
    expect(worthDecodingAt(size(1536, 864), size(767.5, 431.5), 2, false)).toBe(false);
    expect(worthDecodingAt(size(1536, 864), size(768.5, 432), 2, false)).toBe(true);
    // Cropped art is always drawn from its full-size copy.
    expect(worthDecodingAt(size(3840, 2400), size(768, 432), 2, true)).toBe(true);
  });

  it('works out where art lands in its box, and whether it is cropped', async () => {
    const { fitArt } = await load();
    expect(fitArt('cover', size(1920, 1080), size(768, 432))).toEqual({
      drawn: size(768, 432),
      cropped: false,
    });
    // 16:10 art in a 16:9 tile loses 48 device px top and bottom.
    expect(fitArt('cover', size(1920, 1200), size(768, 432))).toEqual({
      drawn: size(768, 432),
      cropped: true,
    });
    // Less than half a pixel over, once drawn: not cropped.
    expect(fitArt('cover', size(1921, 1080), size(768, 432)).cropped).toBe(false);
    expect(fitArt('contain', size(500, 150), size(476.2, 164))).toEqual({
      drawn: size(476, 143),
      cropped: false,
    });
    expect(fitArt('fill', size(500, 150), size(476.2, 164))).toEqual({
      drawn: size(476, 164),
      cropped: false,
    });
  });

  it('at 2, decoding ahead takes wide art the browser would draw at full size', async () => {
    const cases: [[number, number], 1.5 | 2, boolean][] = [
      [[1280, 720], 1.5, false],
      [[1280, 720], 2, true],
      [[1920, 1080], 2, false],
      [[1920, 1200], 2, true],
    ];
    for (const [backdrop, oversize, wide] of cases) {
      FakeImage.decodes = [];
      root = new FakeElement();
      const ahead = await load({ aheadOversize: oversize });
      const { track, rows } = stack(posterRow('a'), posterRow('b'), featuredRow('c', backdrop));
      slide(ahead, track, rows[0]!);
      runFrames(3);
      expect(decodedSrcs()).toEqual([wide ? 'https://art/background/c/0' : 'https://art/logo/c/0']);
    }
  });
});

describe('gridAhead', () => {
  /** A poster grid's track, seven across, with `rows` rows of tiles. */
  function posterGrid(rows: number): { track: FakeElement; row: (n: number) => FakeElement[] } {
    const track = root.appendChild(new FakeElement());
    const tiles: FakeElement[] = [];
    for (let index = 0; index < rows * 7; index++) {
      const tile = track.appendChild(
        new FakeElement({ 'data-focus-key': `discover-tile-${index}` }),
      );
      tile.appendChild(
        image({
          src: `https://art/poster/grid/${index}`,
          natural: [500, 750],
          drawn: [184 + (index % 7) * 244, 220, 330],
        }),
      );
      tiles.push(tile);
    }
    return { track, row: (n) => tiles.slice(n * 7, n * 7 + 7) };
  }

  const handOver = (module: Module, track: FakeElement, key: string, tiles: FakeElement[]) =>
    module.decodeAheadOfTiles(
      track as unknown as HTMLElement,
      key,
      tiles as unknown as HTMLElement[],
    );

  /** Settles each decode as it is asked, until none is left to ask. */
  async function decodeAll(): Promise<void> {
    for (let n = 0; n < 20; n++) {
      runFrames(3);
      await settleDecodes();
    }
  }

  it('is off by default: a grid hands its tiles over for nothing', async () => {
    const ahead = await load();
    expect(ahead.GRID_AHEAD).toBe(false);
    const { track, row } = posterGrid(4);
    handOver(ahead, track, 'grid-0', row(3));
    runFrames(5);
    expect(FakeImage.decodes).toEqual([]);
    expect(track.listeners).toEqual([]);
  });

  it('needs decodeAhead too', async () => {
    const ahead = await load({ gridAhead: true, decodeAhead: false });
    expect(ahead.GRID_AHEAD).toBe(false);
  });

  it('decodes the tiles a grid hands over, in their order, one at a time', async () => {
    const ahead = await load({ gridAhead: true, marks: true });
    const { track, row } = posterGrid(5);
    handOver(ahead, track, 'grid-1', [...row(0), ...row(4)]);
    expect(track.listeners).toEqual(['load']);
    runFrames(3);
    expect(decodedSrcs()).toEqual(['https://art/poster/grid/0']);
    await decodeAll();
    expect(page.marks.filter((name) => name === 'ahead:grid-1')).toHaveLength(14);
    // Only ever the tiles handed over.
    expect(page.marks.filter((name) => !/^ahead(-done)?:grid-1$/.test(name))).toEqual([]);
  });

  it('gives way to a stack of rows that moves to another row', async () => {
    const ahead = await load({ gridAhead: true, marks: true });
    const home = stack(posterRow('a'), posterRow('b'), posterRow('c'), posterRow('d'));
    slide(ahead, home.track, home.rows[0]!);
    const { track, row } = posterGrid(4);
    handOver(ahead, track, 'grid-0', row(3));
    runFrames(3);
    // The grid's tiles, not Home's row after next.
    expect(decodedSrcs()).toEqual(['https://art/poster/grid/21']);
    await settleDecodes();
    slide(ahead, home.track, home.rows[1]!);
    runFrames(3);
    expect(decodedSrcs()).toEqual(['https://art/poster/d/0']);
  });

  it('keeps the grid’s tiles while a stack under it only lays out again where it was', async () => {
    const ahead = await load({ gridAhead: true });
    const home = stack(posterRow('a'), posterRow('b'), posterRow('c'));
    slide(ahead, home.track, home.rows[0]!);
    const { track, row } = posterGrid(4);
    handOver(ahead, track, 'grid-0', row(3));
    runFrames(3);
    expect(decodedSrcs()).toEqual(['https://art/poster/grid/21']);
    await settleDecodes();
    // Home under See all, as Continue Watching or the live row changes.
    slide(ahead, home.track, home.rows[0]!);
    runFrames(3);
    expect(decodedSrcs()).toEqual(['https://art/poster/grid/22']);
    await decodeAll();
    // All seven of the grid's, and none of Home's row after next.
    const asked = page.marks.filter((name) => name.indexOf('ahead:') === 0);
    expect(asked).toEqual(row(3).map(() => 'ahead:grid-0'));
  });

  it('lets go of the tiles of a grid that closes, and only of that grid', async () => {
    const ahead = await load({ gridAhead: true });
    const first = posterGrid(4);
    const second = posterGrid(4);
    handOver(ahead, second.track, 'grid-0', second.row(3));
    ahead.leaveGrid(first.track as unknown as HTMLElement);
    runFrames(3);
    expect(decodedSrcs()).toEqual(['https://art/poster/grid/21']);
    await settleDecodes();
    ahead.leaveGrid(second.track as unknown as HTMLElement);
    runFrames(10);
    expect(FakeImage.decodes).toEqual([]);
  });

  it('with aheadMode raster, draws the tiles under the rail; a new key is a move', async () => {
    const ahead = await load({ gridAhead: true, aheadMode: 'raster' });
    const box = new FakeElement();
    ahead.warmBoxRef(box as unknown as HTMLElement);
    const { track, row } = posterGrid(6);
    handOver(ahead, track, 'grid-0', row(3).slice(0, 2));
    runFrames(10);
    expect(srcs(box)).toEqual(['https://art/poster/grid/21', 'https://art/poster/grid/22']);
    // The same place again, as a page of titles arrives: still the same move.
    handOver(ahead, track, 'grid-0', row(3).slice(0, 3));
    runFrames(10);
    expect(box.children).toHaveLength(3);
    handOver(ahead, track, 'grid-1', row(4).slice(0, 1));
    runFrames(10);
    handOver(ahead, track, 'grid-2', row(5).slice(0, 1));
    // Row 3's posters were drawn for the move before last: they go.
    expect(srcs(box)).toEqual(['https://art/poster/grid/28']);
    expect(FakeImage.decodes).toEqual([]);
  });

  it('with aheadMode raster, a grid that closes takes its art from under the rail, not Home’s', async () => {
    const ahead = await load({ gridAhead: true, aheadMode: 'raster' });
    const box = new FakeElement();
    ahead.warmBoxRef(box as unknown as HTMLElement);
    const home = stack(posterRow('a', 2), posterRow('b', 2), posterRow('c', 2));
    slide(ahead, home.track, home.rows[0]!);
    runFrames(10);
    // See all opens over Home.
    const { track, row } = posterGrid(4);
    handOver(ahead, track, 'grid-0', row(3).slice(0, 2));
    runFrames(10);
    expect(box.children).toHaveLength(4);
    ahead.leaveGrid(track as unknown as HTMLElement);
    expect(srcs(box)).toEqual(['https://art/poster/c/0', 'https://art/poster/c/1']);
  });
});
