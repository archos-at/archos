// @disk-inputs: app/app/(shell)/projects/**, app/app/onboarding/**, app/dev/create-project/**, app/dev/intake/**, app/dev/onboarding/**, app/dev/project-memory-restricted/**, app/dev/project-setup/**, app/dev/projects-home/**, ui/components/projects/**, ui/features/onboarding/**, ui/features/project-intake/**, ui/features/projects/**
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { blankComments } from '../../../scripts/check-static-utility-modifiers.mjs'
import { srcKey, srcJoin } from '@/test-utils/source-tree'


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

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.tsx$/.test(entry) && !/\.(spec|test)\.tsx$/.test(entry)) out.push(path)
  }
  return out
}

const FILES = ROOTS.flatMap((root) => walk(srcJoin(root)))

function classLists(file: string): string[] {
  const code = blankComments(readFileSync(file, 'utf8')) as string
  return [...code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)]
    .map((match) => match[2])
    .filter((text) => text.includes(' '))
}

const tokens = (list: string): string[] => list.split(/\s+/).filter(Boolean)

describe('projects surfaces on a phone', () => {
  it('has files to look at', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('never pairs a fixed height with the top safe-area inset', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      for (const list of classLists(file)) {
        const all = tokens(list)
        const fixed = all.some((token) => /^h-(?:\d+|\[[^\]]+\])$/.test(token))
        const inset = all.some((token) => /^pt-\[.*safe-area-inset-top.*\]$/.test(token))
        if (fixed && inset) offenders.push(`${srcKey(file)}: ${list}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('gives every grid that widens at a breakpoint a column below it', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      for (const list of classLists(file)) {
        const all = tokens(list)
        if (!all.includes('grid')) continue
        const widens = all.some((token) => /^(?:sm|md|lg|xl):grid-cols-\d+$/.test(token))
        const base = all.some((token) => /^grid-cols-/.test(token))
        if (widens && !base) offenders.push(`${srcKey(file)}: ${list}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no `md:`-based touch size in the intake controls', () => {
    const source = readFileSync(srcJoin('features/projects/components/intake-question-field.tsx'), 'utf8')
    expect(source).not.toMatch(/\bmd:min-h-\d+/)
  })
})
