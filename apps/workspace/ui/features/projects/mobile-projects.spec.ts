// @disk-inputs: app/app/(shell)/projects/**, app/app/onboarding/**, app/dev/create-project/**, app/dev/intake/**, app/dev/onboarding/**, app/dev/project-memory-restricted/**, app/dev/project-setup/**, app/dev/projects-home/**, ui/components/projects/**, ui/features/onboarding/**, ui/features/project-intake/**, ui/features/projects/**
import { describe, expect, it } from 'vitest'
import { nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

const ROOTS = [
  'features/projects',
  'features/project-intake',
  'features/onboarding',
  'components/projects',
  'app/app/onboarding',
  'app/app/(shell)/projects',
  'app/dev/projects-home',
  'app/dev/create-project',
  'app/dev/project-setup',
  'app/dev/intake',
  'app/dev/onboarding',
  'app/dev/project-memory-restricted',
]

const FILES = srcEntries()
  .filter((key) => key.endsWith('.tsx') && !/\.(spec|test)\.tsx$/.test(key))
  .filter((key) => ROOTS.some((root) => key.startsWith(`${root}/`)))
  .map((key) => ({ key, source: parseSource(srcPath(key)) }))

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

function classLists(source: ts.SourceFile): string[] {
  return textsOf(source).filter((text) => text.includes(' '))
}

const tokens = (list: string): string[] => list.split(/\s+/).filter(Boolean)

describe('projects surfaces on a phone', () => {
  it('has files to look at', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('never pairs a fixed height with the top safe-area inset', () => {
    const offenders: string[] = []
    for (const { key, source } of FILES) {
      for (const list of classLists(source)) {
        const all = tokens(list)
        const fixed = all.some((token) => /^h-(?:\d+|\[[^\]]+\])$/.test(token))
        const inset = all.some((token) => /^pt-\[.*safe-area-inset-top.*\]$/.test(token))
        if (fixed && inset) offenders.push(`${key}: ${list}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('gives every grid that widens at a breakpoint a column below it', () => {
    const offenders: string[] = []
    for (const { key, source } of FILES) {
      for (const list of classLists(source)) {
        const all = tokens(list)
        if (!all.includes('grid')) continue
        const widens = all.some((token) => /^(?:sm|md|lg|xl):grid-cols-\d+$/.test(token))
        const base = all.some((token) => /^grid-cols-/.test(token))
        if (widens && !base) offenders.push(`${key}: ${list}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no `md:`-based touch size in the intake controls', () => {
    const source = parseSource(srcPath('features/projects/components/intake-question-field.tsx'))
    expect(textsOf(source).some((text) => /\bmd:min-h-\d+/.test(text))).toBe(false)
  })
})
