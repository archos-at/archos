import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

export function markdownToHtml(source: string): string {
  return micromark(source, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}
