import {
  type IAnimationController,
  type INode,
  type ITextNode,
  RendererMain,
} from '@lightningjs/renderer';
import { CanvasTextRenderer } from '@lightningjs/renderer/canvas';
import { WebGlRenderer } from '@lightningjs/renderer/webgl';
import { Rounded, RoundedWithBorder } from '@lightningjs/renderer/webgl/shaders';
import fontUrl from '../../../apps/webos/src/styles/fonts/urbanist-latin.woff2?url';
import {
  type Focus,
  type HomeRow,
  LAYOUT,
  rowOffsets,
  type Shape,
  tilesX,
  tileSize,
  tileStep,
  type Title,
  trackY,
} from './model';
import { COLORS, type HomeView, rgba } from './view';

/**
 * The canvas text renderer has no weight setting, so each weight is its own
 * family over the same variable font, loaded with that weight (see mount).
 */
const FONT = { regular: 'Urbanist', semibold: 'UrbanistSemibold', bold: 'UrbanistBold' } as const;
const WEIGHTS: Record<string, string> = {
  Urbanist: '500',
  UrbanistSemibold: '600',
  UrbanistBold: '700',
};
/** Rows slide under a fixed window that starts a little above the focused row's title. */
const CLIP_TOP = LAYOUT.rowsTop - 24;
/** Graphics memory for textures before the renderer frees those out of view, in bytes. */
const TEXTURE_BUDGET = 160 * 1024 * 1024;

interface RowNodes {
  shape: Shape;
  tiles: INode;
  cells: INode[];
  slide?: IAnimationController;
}

/**
 * Home drawn by the Lightning 3 renderer on a single WebGL canvas. Every tile
 * exists as a node; the renderer only draws, and only loads art for, those
 * within the screen (plus a margin), and frees textures out of view when it
 * nears its memory budget. Motion runs on the renderer's own clock.
 */
export class LightningView implements HomeView {
  private renderer!: RendererMain;
  private rows: readonly HomeRow[] = [];
  private offsets: number[] = [];
  private rowNodes: RowNodes[] = [];
  private track!: INode;
  private ring!: INode;
  private heroArt: INode[] = [];
  private heroFront = 0;
  private heroTitle!: ITextNode;
  private heroInfo!: ITextNode;
  private heroText!: ITextNode;
  private current: Focus | null = null;
  private trackSlide?: IAnimationController;
  private zoomOut?: IAnimationController;
  private zoomIn?: IAnimationController;
  private heroFades: IAnimationController[] = [];
  private textureFailures = 0;

  constructor(
    private readonly host: HTMLElement,
    /** Pixels drawn per page pixel: the TV's own ratio (2 on a 4K LG) or 1. */
    private readonly pixelRatio: number,
  ) {}

  async mount(rows: readonly HomeRow[], focus: Focus): Promise<void> {
    this.rows = rows;
    this.offsets = rowOffsets(rows);
    this.current = focus;
    const renderer = new RendererMain(
      {
        appWidth: LAYOUT.width,
        appHeight: LAYOUT.height,
        deviceLogicalPixelRatio: window.innerWidth / LAYOUT.width,
        devicePhysicalPixelRatio: this.pixelRatio,
        clearColor: rgba(COLORS.bg),
        renderEngine: WebGlRenderer,
        fontEngines: [CanvasTextRenderer],
        // Nodes this far outside the screen still load their art, so a press finds it ready.
        boundsMargin: 400,
        textureMemory: { criticalThreshold: TEXTURE_BUDGET },
      },
      this.host,
    );
    this.renderer = renderer;
    const shaders = renderer.stage.shManager;
    shaders.registerShaderType('Rounded', Rounded);
    shaders.registerShaderType('RoundedWithBorder', RoundedWithBorder);
    // The platform loads fonts with no weight; give each family its weight from the variable font.
    const platform = renderer.stage.platform as unknown as {
      loadFontFace(family: string, url: string): Promise<FontFace>;
      addFont(font: FontFace): void;
    };
    platform.loadFontFace = async (family, url) => {
      const font = await new FontFace(family, `url(${url})`, {
        weight: WEIGHTS[family] ?? '500',
      }).load();
      platform.addFont(font);
      return font;
    };
    for (const family of Object.values(FONT)) {
      await renderer.stage.loadFont('canvas', { fontFamily: family, fontUrl });
    }

    this.drawHero();
    this.drawRows(focus);
    this.drawRing(focus);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private node(props: Parameters<RendererMain['createNode']>[0]): INode {
    return this.renderer.createNode(props);
  }

  private text(props: Parameters<RendererMain['createTextNode']>[0]): ITextNode {
    return this.renderer.createTextNode({
      fontFamily: FONT.regular,
      color: rgba(COLORS.text),
      ...props,
    });
  }

  private drawHero(): void {
    const root = this.renderer.root;
    for (let i = 0; i < 2; i++) {
      this.heroArt.push(
        this.node({ x: 544, y: 0, w: 1376, h: 774, alpha: 0, color: 0xffffffff, parent: root }),
      );
    }
    // Darken towards the text on the left and towards the rows below, with
    // corner colours the GPU blends across each box: no shader, no texture.
    const bg = rgba(COLORS.bg);
    const clear = rgba(COLORS.bg, 0);
    this.node({ x: 0, y: 0, w: 544, h: 774, color: bg, parent: root });
    this.node({
      x: 544,
      y: 0,
      w: 260,
      h: 774,
      colorLeft: bg,
      colorRight: rgba(COLORS.bg, 0.85),
      parent: root,
    });
    this.node({
      x: 804,
      y: 0,
      w: 640,
      h: 774,
      colorLeft: rgba(COLORS.bg, 0.85),
      colorRight: clear,
      parent: root,
    });
    this.node({
      x: 0,
      y: 420,
      w: LAYOUT.width,
      h: 360,
      colorTop: clear,
      colorBottom: bg,
      parent: root,
    });
    this.heroTitle = this.text({
      x: LAYOUT.left,
      y: 150,
      fontFamily: FONT.bold,
      fontSize: 64,
      maxWidth: 900,
      maxLines: 1,
      contain: 'width',
      text: '',
      parent: root,
    });
    this.heroInfo = this.text({
      x: LAYOUT.left,
      y: 240,
      fontSize: 28,
      color: rgba(COLORS.textMuted),
      text: '',
      parent: root,
    });
    this.heroText = this.text({
      x: LAYOUT.left,
      y: 296,
      fontSize: 28,
      lineHeight: 40,
      maxWidth: 760,
      maxLines: 3,
      contain: 'width',
      color: rgba(COLORS.textMuted),
      text: '',
      parent: root,
    });
  }

  private drawRows(focus: Focus): void {
    const clip = this.node({
      x: 0,
      y: CLIP_TOP,
      w: LAYOUT.width,
      h: LAYOUT.height - CLIP_TOP,
      clipping: true,
      // A box with a size is filled white unless told otherwise; this one only clips.
      color: 0x00000000,
      parent: this.renderer.root,
    });
    this.track = this.node({ x: 0, y: trackY(focus, this.offsets) - CLIP_TOP, parent: clip });
    this.rows.forEach((row, r) => {
      const { w, h } = tileSize(row.shape);
      const rowNode = this.node({ x: 0, y: this.offsets[r]!, parent: this.track });
      this.text({
        x: LAYOUT.left,
        y: 0,
        fontFamily: FONT.semibold,
        fontSize: 32,
        text: row.title,
        parent: rowNode,
      });
      const col = focus.cols[r] ?? 0;
      const tiles = this.node({
        x: tilesX(col, row.shape),
        y: LAYOUT.rowTitleHeight,
        parent: rowNode,
      });
      const cells = row.items.map((item, i) => {
        const cell = this.node({
          x: i * tileStep(row.shape),
          y: 0,
          w,
          h,
          pivot: 0.5,
          scale: r === focus.row && i === col ? LAYOUT.focusScale : 1,
          color: rgba(COLORS.surface2),
          shader: this.renderer.createShader('Rounded', { radius: LAYOUT.radius }),
          parent: tiles,
        });
        const src = row.shape === 'poster' ? item.poster : item.background;
        if (src) {
          const art = this.node({
            x: 0,
            y: 0,
            w,
            h,
            src,
            color: 0xffffffff,
            shader: this.renderer.createShader('Rounded', { radius: LAYOUT.radius }),
            parent: cell,
          });
          art.on('failed', () => this.textureFailures++);
        }
        if (row.shape === 'landscape') {
          this.text({
            x: 20,
            y: h - 52,
            fontSize: 26,
            maxWidth: w - 40,
            maxLines: 1,
            contain: 'width',
            text: item.name,
            parent: cell,
          });
        }
        return cell;
      });
      this.rowNodes.push({ shape: row.shape, tiles, cells });
    });
  }

  private drawRing(focus: Focus): void {
    const shape = this.rows[focus.row]?.shape ?? 'poster';
    const { w, h } = tileSize(shape);
    this.ring = this.node({
      x: LAYOUT.left,
      y: LAYOUT.rowsTop + LAYOUT.rowTitleHeight,
      w,
      h,
      pivot: 0.5,
      scale: LAYOUT.focusScale,
      color: 0x00000000,
      zIndex: 10,
      shader: this.renderer.createShader('RoundedWithBorder', {
        radius: LAYOUT.radius + 2,
        'border-w': 5,
        'border-color': rgba(COLORS.focus),
      }),
      parent: this.renderer.root,
    });
  }

  focus(next: Focus): void {
    const before = this.current;
    this.current = next;
    if (!before) return;
    const ease = { duration: LAYOUT.slideMs, easing: 'ease-out' };
    const zoom = { duration: LAYOUT.zoomMs, easing: 'ease-out' };

    if (before.row !== next.row) {
      this.trackSlide?.stop();
      this.trackSlide = this.track.animate({ y: trackY(next, this.offsets) - CLIP_TOP }, ease);
      this.trackSlide.start();
      // The ring takes the new row's tile size at once, as in the HTML mode.
      const { w, h } = tileSize(this.rowNodes[next.row]!.shape);
      this.ring.w = w;
      this.ring.h = h;
    }
    const row = this.rowNodes[next.row]!;
    const col = next.cols[next.row] ?? 0;
    if ((before.cols[next.row] ?? 0) !== col) {
      row.slide?.stop();
      row.slide = row.tiles.animate({ x: tilesX(col, row.shape) }, ease);
      row.slide.start();
    }
    const from = this.rowNodes[before.row]?.cells[before.cols[before.row] ?? 0];
    const to = row.cells[col];
    if (from !== to) {
      this.zoomOut?.stop();
      this.zoomIn?.stop();
      if (from) {
        this.zoomOut = from.animate({ scale: 1 }, zoom);
        this.zoomOut.start();
      }
      if (to) {
        this.zoomIn = to.animate({ scale: LAYOUT.focusScale }, zoom);
        this.zoomIn.start();
      }
    }
  }

  hero(title: Title | undefined): void {
    this.heroTitle.text = title?.name ?? '';
    this.heroInfo.text = title?.info ?? '';
    this.heroText.text = title?.description ?? '';
    const back = this.heroArt[this.heroFront]!;
    this.heroFront = 1 - this.heroFront;
    const front = this.heroArt[this.heroFront]!;
    for (const fade of this.heroFades) fade.stop();
    front.src = title?.background ?? null;
    front.alpha = 0;
    const fade = { duration: LAYOUT.heroFadeMs, easing: 'ease-in-out' };
    this.heroFades = [front.animate({ alpha: 1 }, fade), back.animate({ alpha: 0 }, fade)];
    for (const animation of this.heroFades) animation.start();
  }

  report(): Record<string, number | string | null> {
    const memory = this.renderer.stage.txMemManager.getMemoryInfo();
    return {
      pixelRatio: this.pixelRatio,
      textureMb: Math.round(memory.memUsed / 1048576),
      texturesLoaded: memory.loadedTextures,
      textureFailures: this.textureFailures,
    };
  }

  destroy(): void {
    const renderer = this.renderer as RendererMain & { destroy?: () => void };
    renderer.destroy?.();
  }
}
