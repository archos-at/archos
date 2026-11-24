import { parse } from '@astrojs/compiler-rs';
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { sitemapFilter } from '../../sitemap.mjs';
import { navigation } from '../i18n/nav';
import { LOCALES, ROUTES, UNLISTED_ROUTES, isUnlisted } from '../i18n/paths';

const SRC = join(import.meta.dir, '..');

const OWN_FILES = new Set([
  'views/FirmsView.astro',
  'views/BuildingLawView.astro',
  'views/RevisionsView.astro',
  'views/BlogBlocksView.astro',
  'i18n/pages/blog-blocks.ts',
  'i18n/paths.ts',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(astro|ts|mdx|md)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

type Named = { strings: string[]; routeCalls: string[]; routeMembers: string[] };
type EstreeNode = { type?: string; [key: string]: unknown };

function namedInAstro(text: string): Named {
  const { ast, diagnostics } = parse(text);
  expect(diagnostics).toEqual([]);
  const named: Named = { strings: [], routeCalls: [], routeMembers: [] };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const node = value as EstreeNode;
    if ((node.type === 'Literal' || node.type === 'JSXText' || node.type === 'AstroComment') && typeof node.value === 'string') {
      named.strings.push(node.value);
    }
    if (node.type === 'TemplateElement') {
      const part = node.value as { cooked?: string | null; raw: string };
      named.strings.push(part.cooked ?? part.raw);
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee as EstreeNode;
      const first = (node.arguments as EstreeNode[])[0];
      if (callee.type === 'Identifier' && callee.name === 'localePath' && first?.type === 'Literal' && typeof first.value === 'string') {
        named.routeCalls.push(first.value);
      }
    }
    if (node.type === 'MemberExpression' && !node.computed) {
      const object = node.object as EstreeNode;
      const property = node.property as EstreeNode;
      if (object.type === 'Identifier' && object.name === 'ROUTES') named.routeMembers.push(String(property.name));
    }
    Object.values(node).forEach(visit);
  };
  visit(ast);
  return named;
}

function namedInTypeScript(text: string, fileName: string): Named {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const named: Named = { strings: [], routeCalls: [], routeMembers: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      named.strings.push(node.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'localePath') {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) named.routeCalls.push(first.text);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ROUTES') {
      named.routeMembers.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return named;
}

function namesPath(value: string, path: string): boolean {
  return value.startsWith(path) || ['"', "'", '(', '='].some((before) => value.includes(before + path));
}

describe('unlisted pages', () => {
  test('the navigation and the footer do not link them', () => {
    for (const locale of LOCALES) {
      const nav = navigation(locale);
      const hrefs = [...nav.mainNav, ...nav.footerColumns.flatMap((c) => c.links), ...nav.legal].map((l) => l.href);
      expect(hrefs.filter(isUnlisted)).toEqual([]);
    }
  });

  test('no page, post or copy names their path or route key', () => {
    const paths = UNLISTED_ROUTES.flatMap((key) => [ROUTES[key].de, ROUTES[key].en]);
    const unlisted = new Set<string>(UNLISTED_ROUTES);
    const hits: string[] = [];
    let parsed = 0;
    for (const file of files(SRC)) {
      const name = relative(SRC, file);
      if (OWN_FILES.has(name)) continue;
      const text = readFileSync(file, 'utf8');
      if (name.endsWith('.md') || name.endsWith('.mdx')) {
        for (const path of paths) if (namesPath(text, path)) hits.push(`${name}: ${path}`);
        continue;
      }
      const named = name.endsWith('.astro') ? namedInAstro(text) : namedInTypeScript(text, name);
      parsed += 1;
      for (const key of named.routeCalls) if (unlisted.has(key)) hits.push(`${name}: localePath('${key}'`);
      for (const key of named.routeMembers) if (unlisted.has(key)) hits.push(`${name}: ROUTES.${key}`);
      for (const path of paths) if (named.strings.some((value) => namesPath(value, path))) hits.push(`${name}: ${path}`);
    }
    expect(parsed).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });

  test('the sitemap leaves them out and keeps the listed pages', () => {
    const site = 'https://example.org';
    for (const key of UNLISTED_ROUTES) {
      expect(sitemapFilter(`${site}${ROUTES[key].de}`)).toBe(false);
      expect(sitemapFilter(`${site}${ROUTES[key].en}`)).toBe(false);
    }
    expect(sitemapFilter(`${site}${ROUTES.security.de}`)).toBe(true);
    expect(sitemapFilter(`${site}${ROUTES.home.en}`)).toBe(true);
  });
});
