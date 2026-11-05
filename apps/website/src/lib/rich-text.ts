/**
 * A post's body from the CMS: Lexical's JSON (apps/cms/src/fields/post-body.ts),
 * as `src/components/RichText.astro` draws it. Pure helpers only; nothing here
 * produces HTML. Every text reaches the page through Astro's escaping, a link
 * through `safeHref`, and a block through the components in `PostBlock.astro`,
 * so nothing the CMS holds is ever markup the site did not write.
 */
import GithubSlugger from 'github-slugger';

/** Any Lexical node, loosely: it crosses a network. */
export interface LexicalNode {
  type: string;
  children?: LexicalNode[];
  [key: string]: unknown;
}
export interface LexicalRoot {
  root: LexicalNode;
}

/** Lexical's text format bits (lexical/LexicalConstants). */
const FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16, subscript: 32, superscript: 64 } as const;

/** The elements a text node is wrapped in, outermost first, in the order Markdown nests them. */
export function textMarks(format: unknown): Array<'strong' | 'em' | 's' | 'code' | 'sub' | 'sup'> {
  const bits = typeof format === 'number' ? format : 0;
  const marks: Array<'strong' | 'em' | 's' | 'code' | 'sub' | 'sup'> = [];
  if (bits & FORMAT.bold) marks.push('strong');
  if (bits & FORMAT.italic) marks.push('em');
  if (bits & FORMAT.strikethrough) marks.push('s');
  if (bits & FORMAT.subscript) marks.push('sub');
  if (bits & FORMAT.superscript) marks.push('sup');
  if (bits & FORMAT.code) marks.push('code');
  return marks;
}

/**
 * A link's address when it is one a page may carry: http(s), mailto, tel, a path
 * or a fragment. Anything else (`javascript:`, `data:`) is no link, and the text
 * stands alone.
 */
export function safeHref(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const href = url.trim();
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (href.startsWith('#')) return href;
  try {
    const { protocol } = new URL(href);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** The plain text of a node and everything below it. */
export function plainText(node: LexicalNode): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'linebreak') return '\n';
  return (node.children ?? []).map(plainText).join('');
}

/**
 * The id of every heading, in document order, as the MDX pipeline gives them
 * (Astro's heading-ids step with github-slugger), so a link to `#section` keeps
 * working when a post moves from a fixture to the CMS.
 */
export function headingIds(root: LexicalNode): Map<LexicalNode, string> {
  const slugger = new GithubSlugger();
  const ids = new Map<LexicalNode, string>();
  const visit = (node: LexicalNode) => {
    if (node.type === 'heading') ids.set(node, slugger.slug(plainText(node)));
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return ids;
}

/** The heading tags a post body may hold; its h1 is the post's title. */
export function headingTag(tag: unknown): 'h2' | 'h3' | 'h4' {
  return tag === 'h3' || tag === 'h4' ? tag : 'h2';
}

/** Whether a body is Lexical's JSON at all. */
export function isLexicalRoot(value: unknown): value is LexicalRoot {
  const root = (value as LexicalRoot | null | undefined)?.root;
  return typeof root === 'object' && root !== null && root.type === 'root' && Array.isArray(root.children);
}
