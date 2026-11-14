/**
 * A post's share image (`og:image`), 1200 × 630: its cover's share band, rendered to PNG at
 * build time with sharp. The SVG is the one the page inlines (src/lib/covers.ts); its pens
 * are styled by the same covers.css, with each token replaced by its value from the
 * website's token copy, because a rasteriser reads no custom properties. A cover has no
 * text, so no font is needed. Prerendered: nothing here runs in production.
 */
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { COVER_IDS, SHARE_BAND, renderCover } from '../../../lib/covers';
import coversCss from '../../../styles/brand/covers.css?raw';
import tokensCss from '../../../styles/brand/tokens.css?raw';

export const prerender = true;

export function getStaticPaths() {
  return COVER_IDS.map((id) => ({ params: { id } }));
}

/** The light theme's custom properties and the scalar tokens, name -> value. */
function tokenValues(): Map<string, string> {
  const values = new Map<string, string>();
  // The first block is `:root, [data-theme="light"]`; the dark block comes after and must not win.
  const blocks = tokensCss.split(/\[data-theme="dark"\]\s*\{[^}]*\}/);
  for (const block of blocks) {
    for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      if (!values.has(name)) values.set(name, value.trim());
    }
  }
  return values;
}

/** covers.css with every `var(--token)` written out, and the hatch pointed at the frame's pattern. */
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
