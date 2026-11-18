const FILES = import.meta.glob<string>('../assets/covers/*.svg', { query: '?raw', import: 'default', eager: true });

const COVERS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, svg]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), svg]),
);

export const COVER_IDS = Object.keys(COVERS).sort() as [string, ...string[]];

export const CANVAS = { width: 1200, height: 800 } as const;

export const SHARE_BAND = { x: 0, y: 85, width: 1200, height: 630 } as const;

export const MODULE = 40;

function moduleLines(): string {
  const parts: string[] = [];
  for (let x = MODULE; x < CANVAS.width; x += MODULE) parts.push(`M${x} 0V${CANVAS.height}`);
  for (let y = MODULE; y < CANVAS.height; y += MODULE) parts.push(`M0 ${y}H${CANVAS.width}`);
  return parts.join('');
}

const FRAME_DEFS =
  '<pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<line class="hatch-line" x1="0" y1="0" x2="0" y2="10"/></pattern>';

function drawingOf(id: string): string {
  const svg = COVERS[id];
  if (svg === undefined) throw new Error(`No cover "${id}" in src/assets/covers/.`);
  const body = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)?.[1];
  if (body === undefined) throw new Error(`src/assets/covers/${id}.svg is not one <svg> element.`);
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

interface RenderOptions {
  idPrefix: string;
  band?: boolean;
}

export function renderCover(id: string, { idPrefix, band = false }: RenderOptions): string {
  const box = band ? SHARE_BAND : { x: 0, y: 0, ...CANVAS };
  const inner = `<defs>${FRAME_DEFS}</defs>` +
    `<rect class="ground" width="${CANVAS.width}" height="${CANVAS.height}"/>` +
    `<path class="grid" d="${moduleLines()}"/>` +
    drawingOf(id);
  const prefixed = inner
    .replace(/\bid="([^"]+)"/g, `id="${idPrefix}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${idPrefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${idPrefix}-$1"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ui-cover" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" ` +
    `preserveAspectRatio="xMidYMid slice" style="--hatch: url(#${idPrefix}-hatch)" aria-hidden="true" focusable="false">` +
    `${prefixed}</svg>`;
}

export function coverImagePath(id: string): string {
  return `/media/covers/${id}.png`;
}
