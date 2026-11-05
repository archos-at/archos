/**
 * One MDX post of the website, as the CMS holds it: its frontmatter, and its
 * body as Lexical rich text (`lexical.mjs`).
 *
 * The posts are Markdown (with GitHub's tables) plus figure components from
 * apps/website/src/components/figures/. Markdown becomes the editor's own nodes
 * (headings, lists, links, ...); each figure becomes the typed block of the same
 * component (apps/cms/src/blocks/post-blocks.ts), its props as the block's fields.
 *
 * Anything else MDX can hold (other components, expressions, exports, raw HTML)
 * has no home in the CMS and fails the conversion with its line, rather than
 * being dropped.
 */
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import YAML from 'yaml';
import { blockLevel, blockNode, root } from './lexical.mjs';

/** The website's figure components and the block each one is in the CMS. */
export const FIGURE_BLOCKS = {
  IsoStackFigure: 'isoStackFigure',
  ScopeFigure: 'scopeFigure',
  HybridFigure: 'hybridFigure',
  LessonLoopFigure: 'lessonLoopFigure',
};
const FIGURES_IMPORT = /^import\s+(\w+)\s+from\s+['"][./]+\/components\/figures\/(\w+)\.astro['"];?$/;

/**
 * The value of a JSX attribute expression that is a literal: strings, numbers,
 * booleans, null, arrays and plain objects of those. Anything computed is refused,
 * because the CMS stores props as JSON.
 */
export function literalValue(node, where) {
  switch (node.type) {
    case 'Literal':
      if (node.regex || node.bigint !== undefined) break;
      return node.value;
    case 'ArrayExpression':
      return node.elements.map((element) => {
        if (element === null || element.type === 'SpreadElement') throw new Error(`${where}: holes and spreads have no JSON form`);
        return literalValue(element, where);
      });
    case 'ObjectExpression':
      return Object.fromEntries(
        node.properties.map((property) => {
          if (property.type !== 'Property' || property.computed || property.kind !== 'init') {
            throw new Error(`${where}: only plain object properties have a JSON form`);
          }
          const key = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
          return [key, literalValue(property.value, where)];
        }),
      );
    case 'TemplateLiteral':
      if (node.expressions.length === 0) return node.quasis[0].value.cooked;
      break;
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
        return -node.argument.value;
      }
      break;
    default:
      break;
  }
  throw new Error(`${where}: a ${node.type} is not a literal, and the CMS keeps props as JSON`);
}

/** A JSX element's attributes as one props object. */
function propsOf(element, where) {
  const props = {};
  for (const attribute of element.attributes) {
    if (attribute.type !== 'mdxJsxAttribute') throw new Error(`${where}: spread attributes have no JSON form`);
    const { name, value } = attribute;
    if (value === null || value === undefined) props[name] = true;
    else if (typeof value === 'string') props[name] = value;
    else {
      const program = value.data?.estree;
      const statement = program?.body?.[0];
      if (!statement || statement.type !== 'ExpressionStatement') throw new Error(`${where}: attribute ${name} is not an expression`);
      props[name] = literalValue(statement.expression, `${where}, attribute ${name}`);
    }
  }
  return props;
}

/**
 * @param {string} source  the .mdx file's text
 * @param {string} file    its path, for messages
 * @returns {{ frontmatter: Record<string, unknown>, body: { root: object } }}
 */
export function parseMdxPost(source, file) {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']).use(remarkMdx).parse(source);
  const where = (node) => `${file}:${node.position?.start.line}`;
  const nodes = [];
  const imported = new Map();
  let frontmatter;
  for (const node of tree.children) {
    if (node.type === 'yaml') {
      frontmatter = YAML.parse(node.value);
    } else if (node.type === 'mdxjsEsm') {
      for (const line of node.value.split('\n').filter((l) => l.trim() !== '')) {
        const match = FIGURES_IMPORT.exec(line.trim());
        if (!match || match[1] !== match[2] || !(match[1] in FIGURE_BLOCKS)) {
          throw new Error(`${where(node)}: only figure imports may stand in a post, not "${line.trim()}"`);
        }
        imported.set(match[1], FIGURE_BLOCKS[match[1]]);
      }
    } else if (node.type === 'mdxJsxFlowElement') {
      const blockType = imported.get(node.name);
      if (!blockType) throw new Error(`${where(node)}: <${node.name}> is not an imported figure component`);
      if (node.children.length > 0) throw new Error(`${where(node)}: <${node.name}> has children, and a figure takes props only`);
      nodes.push(blockNode(blockType, propsOf(node, where(node)), `${file}:${nodes.length}:${blockType}`));
    } else {
      nodes.push(...blockLevel(node, where));
    }
  }
  if (!frontmatter) throw new Error(`${file}: no frontmatter`);
  return { frontmatter, body: root(nodes) };
}
