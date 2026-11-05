/**
 * Markdown from the CMS (a post's `block_markdown`) as HTML: CommonMark with GitHub's tables,
 * strikethrough and autolinks, through micromark. Raw HTML in the source is escaped, never
 * passed through (micromark's default), so an editor or an agent cannot put a script or a
 * style on the page; the Content-Security-Policy would refuse one anyway.
 */
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

export function markdownToHtml(source: string): string {
  return micromark(source, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}
