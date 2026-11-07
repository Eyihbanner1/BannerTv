import {
  type Focus,
  type HomeRow,
  LAYOUT,
  rowOffsets,
  tilesX,
  tileSize,
  tileStep,
  type Title,
  trackY,
} from './model';
import { COLORS, type HomeView } from './view';
import './html-view.css';

const CLIP_TOP = LAYOUT.rowsTop - 24;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

function place(node: HTMLElement, x: number, y: number, w?: number, h?: number): void {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  if (w !== undefined) node.style.width = `${w}px`;
  if (h !== undefined) node.style.height = `${h}px`;
}

/**
 * The same Home in HTML, with the same motion done the way a careful web app
 * does it: transforms and opacity only, CSS transitions, the sliding tracks
 * on their own layers. This is the fair comparison for the WebGL modes; the
 * shipping app today goes further and turns this motion off.
 */
export class HtmlView implements HomeView {
  private offsets: number[] = [];
  private track!: HTMLElement;
  private rowTracks: HTMLElement[] = [];
  private cells: HTMLElement[][] = [];
  private ring!: HTMLElement;
  private heroArt: HTMLImageElement[] = [];
  private heroFront = 0;
  private heroTitle!: HTMLElement;
  private heroInfo!: HTMLElement;
  private heroText!: HTMLElement;
  private rows: readonly HomeRow[] = [];
  private current: Focus | null = null;
  private root!: HTMLElement;
  private imageFailures = 0;

  constructor(private readonly host: HTMLElement) {}

  async mount(rows: readonly HomeRow[], focus: Focus): Promise<void> {
    this.rows = rows;
    this.offsets = rowOffsets(rows);
    this.current = focus;
    const root = element('div', 'mt-home', this.host);
    root.style.setProperty('--mt-slide', `${LAYOUT.slideMs}ms`);
    root.style.setProperty('--mt-zoom', `${LAYOUT.zoomMs}ms`);
    root.style.setProperty('--mt-fade', `${LAYOUT.heroFadeMs}ms`);
    root.style.background = COLORS.bg;
    this.root = root;

    for (let i = 0; i < 2; i++) {
      const art = element('img', 'mt-hero-art', root);
      art.decoding = 'async';
      art.alt = '';
      place(art, 544, 0, 1376, 774);
      this.heroArt.push(art);
    }
    element('div', 'mt-hero-shade', root);
    this.heroTitle = element('h1', 'mt-hero-title', root);
    this.heroInfo = element('p', 'mt-hero-info', root);
    this.heroText = element('p', 'mt-hero-text', root);

    const clip = element('div', 'mt-clip', root);
    place(clip, 0, CLIP_TOP, LAYOUT.width, LAYOUT.height - CLIP_TOP);
    this.track = element('div', 'mt-track', clip);
    this.setY(this.track, trackY(focus, this.offsets) - CLIP_TOP);
    rows.forEach((row, r) => {
      const { w, h } = tileSize(row.shape);
      const rowNode = element('section', 'mt-row', this.track);
      place(rowNode, 0, this.offsets[r]!);
      const title = element('h2', 'mt-row-title', rowNode);
      title.textContent = row.title;
      place(title, LAYOUT.left, 0);
      const tiles = element('div', 'mt-tiles', rowNode);
      place(tiles, 0, LAYOUT.rowTitleHeight);
      this.setX(tiles, tilesX(focus.cols[r] ?? 0, row.shape));
      this.rowTracks.push(tiles);
      this.cells.push(
        row.items.map((item, i) => {
          const cell = element('div', 'mt-tile', tiles);
          place(cell, i * tileStep(row.shape), 0, w, h);
          const src = row.shape === 'poster' ? item.poster : item.background;
          if (src) {
            const img = element('img', 'mt-tile-art', cell);
            img.decoding = 'async';
            img.alt = '';
            img.onerror = () => this.imageFailures++;
            img.src = src;
          }
          if (row.shape === 'landscape') {
            const name = element('span', 'mt-tile-name', cell);
            name.textContent = item.name;
          }
          if (r === focus.row && i === (focus.cols[r] ?? 0)) cell.classList.add('mt-focused');
          return cell;
        }),
      );
    });
    this.ring = element('div', 'mt-ring', root);
    const { w, h } = tileSize(rows[focus.row]?.shape ?? 'poster');
    place(this.ring, LAYOUT.left, LAYOUT.rowsTop + LAYOUT.rowTitleHeight, w, h);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private setX(node: HTMLElement, x: number): void {
    node.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  private setY(node: HTMLElement, y: number): void {
    node.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  focus(next: Focus): void {
    const before = this.current;
    this.current = next;
    if (!before) return;
    if (before.row !== next.row) {
      this.setY(this.track, trackY(next, this.offsets) - CLIP_TOP);
      const { w, h } = tileSize(this.rows[next.row]!.shape);
      this.ring.style.width = `${w}px`;
      this.ring.style.height = `${h}px`;
    }
    const col = next.cols[next.row] ?? 0;
    if ((before.cols[next.row] ?? 0) !== col) {
      this.setX(this.rowTracks[next.row]!, tilesX(col, this.rows[next.row]!.shape));
    }
    const from = this.cells[before.row]?.[before.cols[before.row] ?? 0];
    const to = this.cells[next.row]?.[col];
    if (from !== to) {
      from?.classList.remove('mt-focused');
      to?.classList.add('mt-focused');
    }
  }

  hero(title: Title | undefined): void {
    this.heroTitle.textContent = title?.name ?? '';
    this.heroInfo.textContent = title?.info ?? '';
    this.heroText.textContent = title?.description ?? '';
    const back = this.heroArt[this.heroFront]!;
    this.heroFront = 1 - this.heroFront;
    const front = this.heroArt[this.heroFront]!;
    back.classList.remove('mt-shown');
    front.classList.remove('mt-shown');
    const show = () => front.classList.add('mt-shown');
    if (title?.background) {
      front.onload = show;
      front.src = title.background;
    }
  }

  report(): Record<string, number | string | null> {
    return { pixelRatio: window.devicePixelRatio || 1, imageFailures: this.imageFailures };
  }

  destroy(): void {
    this.root.remove();
  }
}
