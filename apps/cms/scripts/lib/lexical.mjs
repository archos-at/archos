/**
 * Markdown (mdast) to the Lexical JSON a post's body holds, node for node in
 * the shapes Payload's editor writes (read from @payloadcms/richtext-lexical
 * 3.93.0's own Markdown converter on 2026-11-05). Pure.
 *
 * Ours rather than Payload's `convertMarkdownToLexical` because that one flattens
 * a nested list into its parent, and because a figure here is a typed block with
 * its props as fields, which its JSX converters would take as strings.
 */
import { createHash } from 'node:crypto';

/** Lexical's text format bits. */
export const FORMAT = { bold: 1, italic: 2, strikethrough: 4, underline: 8, code: 16 };

const element = (type, children, extra = {}) => ({ type, version: 1, direction: null, format: '', indent: 0, ...extra, children });
const text = (value, format = 0) => ({ type: 'text', version: 1, detail: 0, format, mode: 'normal', style: '', text: value });
export const paragraph = (children) => element('paragraph', children, { textFormat: 0, textStyle: '' });
export const root = (children) => ({ root: element('root', children) });

/** A stable id for a block, from where it stands and what it holds, so a re-import compares equal. */
export function blockId(seed) {
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

export function blockNode(blockType, fields, seed) {
  return { type: 'block', version: 2, format: '', fields: { id: blockId(seed ?? `${blockType}:${JSON.stringify(fields)}`), blockName: '', blockType, ...fields } };
}

const INLINE_FORMAT = { strong: FORMAT.bold, emphasis: FORMAT.italic, delete: FORMAT.strikethrough };

/** Inline mdast children as Lexical inline nodes, formats accumulated down the tree. */
function inline(nodes, where, format = 0) {
  return nodes.flatMap((node) => {
    // A soft line break in the source is a space on the page; Lexical keeps no newline in text.
    if (node.type === 'text') return node.value ? [text(node.value.replace(/[ \t]*\n[ \t]*/g, ' '), format)] : [];
    if (node.type === 'inlineCode') return [text(node.value, format | FORMAT.code)];
    if (node.type === 'break') return [{ type: 'linebreak', version: 1 }];
    if (node.type in INLINE_FORMAT) return inline(node.children, where, format | INLINE_FORMAT[node.type]);
    if (node.type === 'link') {
      return [element('link', inline(node.children, where, format), { version: 3, fields: { linkType: 'custom', newTab: false, url: node.url } })];
    }
    throw new Error(`${where(node)}: ${node.type} has no form in a post's body`);
  });
}

/** A list item's content: its paragraphs' inline nodes, joined by line breaks; a nested list follows as its own item. */
function listItems(list, where) {
  let value = list.start ?? 1;
  return list.children.flatMap((item) => {
    const inlines = [];
    const nested = [];
    for (const child of item.children) {
      if (child.type === 'paragraph') {
        if (inlines.length > 0) inlines.push({ type: 'linebreak', version: 1 });
        inlines.push(...inline(child.children, where));
      } else if (child.type === 'list') nested.push(listNode(child, where));
      else throw new Error(`${where(child)}: a ${child.type} inside a list item has no form in a post's body`);
    }
    const items = [element('listitem', inlines, { value: value++ })];
    // Lexical nests a list as the only child of a list item of its own.
    for (const list of nested) items.push(element('listitem', [list], { value: value++ }));
    return items;
  });
}

function listNode(node, where) {
  return element('list', listItems(node, where), {
    listType: node.ordered ? 'number' : 'bullet',
    start: node.start ?? 1,
    tag: node.ordered ? 'ol' : 'ul',
  });
}

function tableNode(node, where) {
  return element(
    'table',
    node.children.map((row, r) =>
      element(
        'tablerow',
        row.children.map((cell) =>
          element('tablecell', [paragraph(inline(cell.children, where))], { backgroundColor: null, colSpan: 1, rowSpan: 1, headerState: r === 0 ? 1 : 0 }),
        ),
      ),
    ),
  );
}

/**
 * One block-level mdast node as Lexical nodes. `where(node)` names a node's
 * place for messages; anything without a form in the editor fails with it.
 */
export function blockLevel(node, where) {
  switch (node.type) {
    case 'paragraph':
      return [paragraph(inline(node.children, where))];
    case 'heading':
      if (node.depth < 2) throw new Error(`${where(node)}: a post's only h1 is its title`);
      return [element('heading', inline(node.children, where), { tag: `h${Math.min(node.depth, 4)}` })];
    case 'list':
      return [listNode(node, where)];
    case 'blockquote':
      return [element('quote', node.children.flatMap((child, i) => {
        if (child.type !== 'paragraph') throw new Error(`${where(child)}: a quote holds paragraphs only`);
        return [...(i > 0 ? [{ type: 'linebreak', version: 1 }] : []), ...inline(child.children, where)];
      }))];
    case 'table':
      return [tableNode(node, where)];
    case 'thematicBreak':
      return [{ type: 'horizontalrule', version: 1 }];
    case 'code':
      return [blockNode('code', { language: node.lang ?? 'text', code: node.value })];
    default:
      throw new Error(`${where(node)}: ${node.type} has no form in a post's body`);
  }
}

/** Everything the import compares, without the ids an editor's save may renumber. */
export function withoutIds(value) {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id' && key !== '$').map(([key, v]) => [key, withoutIds(v)]));
  }
  return value;
}
