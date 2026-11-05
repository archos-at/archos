/**
 * Blog covers: one line drawing per post, in `src/assets/covers/<id>.svg`, named in the
 * post's frontmatter as `cover: <id>`. The rules and how to draw one:
 * packages/brand/docs/blog-covers.md.
 *
 * A cover file holds only its drawing. This module puts every drawing into the same frame,
 * so no cover can differ in what all of them share: the 1200 × 800 canvas, the sunken
 * ground, the 40-unit module grid and the hatch. The page inlines the result (its pens are
 * styled by the brand's covers.css, from the tokens); src/pages/media/covers renders the
 * same SVG to the post's 1200 × 630 share image.
 */

const FILES = import.meta.glob<string>('../assets/covers/*.svg', { query: '?raw', import: 'default', eager: true });

const COVERS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, svg]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), svg]),
);

/** Every cover a post may name. The content schema takes its `cover` from this list. */
export const COVER_IDS = Object.keys(COVERS).sort() as [string, ...string[]];

/** The canvas, in drawing units. Every cover is drawn on it. */
export const CANVAS = { width: 1200, height: 800 } as const;

/** The share band: the 1200 × 630 strip of the canvas a share image and a post's banner show. */
export const SHARE_BAND = { x: 0, y: 85, width: 1200, height: 630 } as const;

/** The module of the grid. Coordinates in a cover are multiples of it, or of its half. */
export const MODULE = 40;

/** Horizontal and vertical lines every module, as one path. */
function gridPath(): string {
  const parts: string[] = [];
  for (let x = MODULE; x < CANVAS.width; x += MODULE) parts.push(`M${x} 0V${CANVAS.height}`);
  for (let y = MODULE; y < CANVAS.height; y += MODULE) parts.push(`M0 ${y}H${CANVAS.width}`);
  return parts.join('');
}

const FRAME_DEFS =
  '<pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<line class="hatch-line" x1="0" y1="0" x2="0" y2="10"/></pattern>';

/** The drawing inside a cover file: everything between its root `<svg …>` and `</svg>`. */
function drawingOf(id: string): string {
  const svg = COVERS[id];
  if (svg === undefined) throw new Error(`No cover "${id}" in src/assets/covers/.`);
  const body = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)?.[1];
  if (body === undefined) throw new Error(`src/assets/covers/${id}.svg is not one <svg> element.`);
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

interface RenderOptions {
  /** Prefix for every id in the drawing, so several covers can share a page. */
  idPrefix: string;
  /** The part of the canvas to show: the whole canvas (default) or the share band. */
  band?: boolean;
  /** Extra attributes for the root, already escaped. */
  attributes?: string;
}

/**
 * The cover as one `<svg>` element: the frame, then the drawing. Decorative: the post's
 * title says what the post is about, so the drawing is hidden from assistive technology.
 */
export function renderCover(id: string, { idPrefix, band = false, attributes = '' }: RenderOptions): string {
  const box = band ? SHARE_BAND : { x: 0, y: 0, ...CANVAS };
  const inner = `<defs>${FRAME_DEFS}</defs>` +
    `<rect class="ground" width="${CANVAS.width}" height="${CANVAS.height}"/>` +
    `<path class="grid" d="${gridPath()}"/>` +
    drawingOf(id);
  const prefixed = inner
    .replace(/\bid="([^"]+)"/g, `id="${idPrefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${idPrefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${idPrefix}-$1"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ui-cover" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" ` +
    `preserveAspectRatio="xMidYMid slice" style="--hatch: url(#${idPrefix}-hatch)" aria-hidden="true" focusable="false"${attributes}>` +
    `${prefixed}</svg>`;
}

/** Where a post's share image is served: rendered at build time from the cover. */
export function coverImagePath(id: string): string {
  return `/media/covers/${id}.png`;
}
