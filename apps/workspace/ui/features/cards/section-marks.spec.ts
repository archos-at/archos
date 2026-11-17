// @disk-inputs: ui/features/cards/**
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blankComments } from '../../../scripts/check-static-utility-modifiers.mjs'

const ROOT = __dirname

const KEPT: Record<string, string> = {
  'components/VerdictHeaderCard.tsx': 'the gavel marks a ruling; the label is its subject',
}

const sources = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx$/.test(entry) && !/\.(spec|test)\.tsx$/.test(entry)) out.push(path)
  }
  return out
}

describe('section marks in the answer are text only', () => {
  it('no card hands SectionLabel an icon', () => {
    const offenders = sources(ROOT)
      .map((file) => file.slice(ROOT.length + 1))
      .filter((file) => !(file in KEPT))
      .filter((file) => /<SectionLabel\b[^>]*\bicon=/.test(blankComments(readFileSync(join(ROOT, file), 'utf8')) as string))
    expect(offenders).toEqual([])
  })

  it('a kept icon is still there, or its entry goes', () => {
    for (const file of Object.keys(KEPT)) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/<SectionLabel\b[^>]*\bicon=/)
    }
  })
})
