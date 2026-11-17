import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { COVER_IDS, SHARE_BAND, renderCover } from '../../../lib/covers';
import coversCss from '../../../styles/brand/covers.css?raw';
import tokensCss from '../../../styles/brand/tokens.css?raw';

export const prerender = true;

export function getStaticPaths() {
  return COVER_IDS.map((id) => ({ params: { id } }));
}

function tokenValues(): Map<string, string> {
  const values = new Map<string, string>();
  const blocks = tokensCss.split(/\[data-theme="dark"\]\s*\{[^}]*\}/);
  for (const block of blocks) {
    for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      if (!values.has(name)) values.set(name, value.trim());
    }
  }
  return values;
}

function resolvedStyles(idPrefix: string): string {
  const tokens = tokenValues();
  tokens.set('--hatch', `url(#${idPrefix}-hatch)`);
  const css = coversCss.replace(/\/\*[\s\S]*?\*\//g, '');
  return css.replace(/var\((--[\w-]+)\)/g, (_match, name: string) => {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`covers.css reads ${name}, which tokens.css does not define.`);
    return value;
  });
}

export const GET: APIRoute = async ({ params }) => {
  const id = params.id as string;
  const idPrefix = 'share';
  const style = `<style>${resolvedStyles(idPrefix)}</style>`;
  const svg = renderCover(id, { idPrefix, band: true }).replace(/(<svg\b[^>]*>)/, `$1${style}`)
    .replace(/<svg\b/, `<svg width="${SHARE_BAND.width}" height="${SHARE_BAND.height}"`);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
