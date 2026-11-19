// @disk-inputs: app/app/(shell)/organization/**, app/app/(shell)/platform/**, app/app/(shell)/profile/**, ui/components/charts/**, ui/features/budgets/**, ui/features/organization/**, ui/features/platform/**

import { describe, expect, it } from 'vitest'
import { nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

const ADMIN_DIRS = [
  'features/organization',
  'features/platform',
  'features/budgets',
  'components/charts',
  'app/app/(shell)/organization',
  'app/app/(shell)/platform',
  'app/app/(shell)/profile',
]

const ADMIN_FILES = srcEntries()
  .filter((key) => key.endsWith('.tsx') && !key.endsWith('.spec.tsx'))
  .filter((key) => ADMIN_DIRS.some((dir) => key.startsWith(`${dir}/`)))
  .map((key) => ({ key, source: parseSource(srcPath(key)) }))

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

function openingsOf(source: ts.SourceFile, tag: string): Opening[] {
  return nodesOf(
    source,
    (node): node is Opening =>
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === tag,
  )
}

function staticClassName(opening: Opening): string | undefined {
  for (const attribute of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === 'className' &&
      attribute.initializer &&
      ts.isStringLiteral(attribute.initializer)
    ) {
      return attribute.initializer.text
    }
  }
  return undefined
}

function textsOf(source: ts.SourceFile): string[] {
  return nodesOf(
    source,
    (
      node,
    ): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node),
  ).map((node) => node.text)
}

const classesIn = (text: string): string[] => text.split(/\s+/).filter(Boolean)

describe('admin surfaces on a phone', () => {
  it('scans the admin surfaces', () => {
    expect(ADMIN_FILES.length).toBeGreaterThan(0)
  })

  it('draws no chart inside a width-floored scroll box', () => {
    const offenders = ADMIN_FILES.filter(({ key }) => key.startsWith('components/charts/'))
      .filter(({ source }) => textsOf(source).some((text) => /min-w-\[\d+px\]/.test(text)))
      .map(({ key }) => key)
    expect(offenders).toEqual([])
  })

  it('truncates the value of every fixed-width select trigger', () => {
    const offenders: string[] = []
    for (const { key, source } of ADMIN_FILES) {
      for (const opening of openingsOf(source, 'SelectTrigger')) {
        const classes = staticClassName(opening)
        if (classes === undefined) continue
        const fixedWidth = classesIn(classes).some((token) => /^w-\d+$/.test(token))
        if (fixedWidth && !classes.includes('[&>span]:truncate')) offenders.push(`${key}: ${classes}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('makes a truncating table cell width-bound, not just max-width-bound', () => {
    const offenders: string[] = []
    for (const { key, source } of ADMIN_FILES) {
      for (const opening of openingsOf(source, 'TableCell')) {
        const classes = staticClassName(opening)
        if (classes !== undefined && /max-w-\[/.test(classes) && !/max-w-0/.test(classes)) {
          offenders.push(`${key}: ${classes}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('shows the keyboard-shortcut card only where a keyboard can be', () => {
    const source = parseSource(srcPath('app/app/(shell)/profile/profile-controls.tsx'))
    const [shortcut] = openingsOf(source, 'ShortcutSettings')
    expect(shortcut).toBeDefined()
    const wrapper = shortcut!.parent
    expect(ts.isJsxElement(wrapper)).toBe(true)
    const classes = staticClassName((wrapper as ts.JsxElement).openingElement) ?? ''
    expect(classesIn(classes)).toContain('any-pointer-fine:block')
  })
})
