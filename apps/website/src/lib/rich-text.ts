import GithubSlugger from 'github-slugger';

export interface LexicalNode {
  type: string;
  children?: LexicalNode[];
  [key: string]: unknown;
}
export interface LexicalRoot {
  root: LexicalNode;
}

const FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16, subscript: 32, superscript: 64 } as const;

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

export function hoistLinkMarks(link: LexicalNode): { outer: ReturnType<typeof textMarks>; children: LexicalNode[] } {
  const children = link.children ?? [];
  const texts = children.filter((c) => c.type === 'text');
  if (texts.length === 0 || texts.length !== children.length) return { outer: [], children };
  const shared = texts.reduce((bits, t) => bits & (typeof t.format === 'number' ? t.format : 0), ~0) & ~FORMAT.code;
  if (shared === 0) return { outer: [], children };
  return {
    outer: textMarks(shared),
    children: texts.map((t) => ({ ...t, format: (t.format as number) & ~shared })),
  };
}

export function plainText(node: LexicalNode): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'linebreak') return '\n';
  return (node.children ?? []).map(plainText).join('');
}

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

export function headingTag(tag: unknown): 'h2' | 'h3' | 'h4' {
  return tag === 'h3' || tag === 'h4' ? tag : 'h2';
}

export function isLexicalRoot(value: unknown): value is LexicalRoot {
  const root = (value as LexicalRoot | null | undefined)?.root;
  return typeof root === 'object' && root !== null && root.type === 'root' && Array.isArray(root.children);
}
