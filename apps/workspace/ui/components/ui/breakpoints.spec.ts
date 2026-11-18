// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**

import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import postcss, { type AtRule, type Root, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

import { MOBILE_LAYOUT_QUERY, PHONE_ON_ITS_SIDE_QUERY, PHONE_QUERY } from '@/hooks/use-is-mobile'
import { parseSource, ts, walk as visit } from '@/test-utils/source-ast'
import { SOURCE_DIRS, srcKey, srcJoin } from '@/test-utils/source-tree'

const UI_ROOT = process.cwd()
const GLOBALS = postcss.parse(readFileSync(srcJoin('app', 'globals.css'), 'utf8'))

function customVariant(name: string): AtRule {
  const found = GLOBALS.nodes.find(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'custom-variant' && node.params === name,
  )
  expect(found, `@custom-variant ${name}`).toBeDefined()
  return found as AtRule
}

const mediaQueriesIn = (node: Root | AtRule): string[] => {
  const queries: string[] = []
  node.walkAtRules('media', (rule) => {
    queries.push(rule.params)
  })
  return queries
}

const ancestorMediaQueries = (node: Rule): string[] => {
  const queries: string[] = []
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'media') queries.unshift(parent.params)
  }
  return queries
}

const ruleWithSelector = (css: Root, selector: string): Rule => {
  const found: Rule[] = []
  css.walkRules(selector, (rule) => {
    found.push(rule)
  })
  expect(found, selector).not.toHaveLength(0)
  return found[0]
}

describe('the stylesheet and the hook ask the same question', () => {
  it('md is "at least 768px wide, and not a phone on its side"', () => {
    const md = mediaQueriesIn(customVariant('md'))
    expect(md).toContain('(width >= 48rem)')
    expect(md).toContain(`not all and ${PHONE_ON_ITS_SIDE_QUERY}`)
  })

  it('max-md is exactly the phone shell useIsMobile() reports', () => {
    expect(mediaQueriesIn(customVariant('max-md'))).toContain(MOBILE_LAYOUT_QUERY)
  })

  it('phone is below sm, or a phone on its side', () => {
    expect(mediaQueriesIn(customVariant('phone'))).toContain(PHONE_QUERY)
  })
})

describe('Tailwind honours the override', () => {
  const require = createRequire(join(UI_ROOT, 'package.json'))
  const tailwindRoot = dirname(require.resolve('tailwindcss/package.json'))

  const nodes = GLOBALS.nodes
  const variants = nodes
    .slice(nodes.indexOf(customVariant('md')), nodes.indexOf(customVariant('phone')) + 1)
    .map((node) => node.toString())
    .join('\n')

  async function build(candidates: string[]): Promise<Root> {
    const { compile } = require('tailwindcss') as typeof import('tailwindcss')
    const css = [
      '@layer theme, base, components, utilities;',
      "@import 'tailwindcss/theme.css' layer(theme);",
      "@import 'tailwindcss/utilities.css' layer(utilities);",
      variants,
    ].join('\n')
    const compiler = await compile(css, {
      base: UI_ROOT,
      loadStylesheet: async (id: string) => {
        const path = join(tailwindRoot, id.replace(/^tailwindcss\//, ''))
        return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
      },
    })
    return postcss.parse(compiler.build(candidates))
  }

  it('wraps md: in the phone exclusion, and leaves lg: as Tailwind wrote it', async () => {
    const css = await build(['md:flex', 'lg:grid'])
    const queries = ancestorMediaQueries(ruleWithSelector(css, '.md\\:flex'))
    expect(queries.lastIndexOf(`not all and ${PHONE_ON_ITS_SIDE_QUERY}`)).toBeGreaterThan(
      queries.lastIndexOf('(width >= 48rem)')
    )

    const lgMedia: AtRule[] = []
    css.walkAtRules('media', (rule) => {
      if (rule.params === '(width >= 64rem)') lgMedia.push(rule)
    })
    expect(lgMedia.some((rule) => rule.first?.type === 'rule' && rule.first.selector === '.lg\\:grid')).toBe(true)
  })

  it('keeps md: in its place in the cascade, after sm: and before lg:', async () => {
    const css = await build(['lg:grid', 'md:flex', 'sm:block'])
    const selectors: string[] = []
    css.walkRules((rule) => {
      selectors.push(rule.selector)
    })
    const order = ['.sm\\:block', '.md\\:flex', '.lg\\:grid'].map((cls) => selectors.indexOf(cls))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

describe('no breakpoint is written by hand into JavaScript', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path, out)
      else if (/\.tsx?$/.test(entry) && !/\.(?:spec|test)\.tsx?$/.test(entry)) out.push(path)
    }
    return out
  }

  const RAW_MD = /\((?:max|min)-width:\s*(?:767|768)(?:\.\d+)?px\)|\(width\s*[<>]=?\s*48rem\)/

  const isSizesValue = (node: ts.Node): boolean => {
    for (let owner = node.parent; owner; owner = owner.parent) {
      if (ts.isJsxAttribute(owner) || ts.isPropertyAssignment(owner)) return owner.name.getText() === 'sizes'
    }
    return false
  }

  const rawMdLiterals = (file: string): string[] => {
    const found: string[] = []
    visit(parseSource(file), (node) => {
      if (ts.isStringLiteralLike(node) && RAW_MD.test(node.text) && !isSizesValue(node)) found.push(node.text)
    })
    return found
  }

  it('asks for the phone shell through use-is-mobile, never a raw md width', () => {
    const offenders = SOURCE_DIRS.flatMap((dir) => walk(join(process.cwd(), dir)))
      .filter((file) => !file.endsWith(join('hooks', 'use-is-mobile.ts')))
      .filter((file) => rawMdLiterals(file).length > 0)
      .map((file) => srcKey(file))
    expect(offenders).toEqual([])
  })
})
