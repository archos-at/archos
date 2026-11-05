// @disk-inputs: ui/features/cards/**
/**
 * A card's section mark in the answer is a word, not an icon and a word
 * (Notion #38, topic 10). „Angesehen" beside a magnifier, „Aufgabe" beside a
 * clipboard: the two said the same thing, and the icon only added weight to
 * the quietest element of the card. The rule held by this spec is the source
 * form of that: no `SectionLabel` under `features/cards` takes an `icon`.
 *
 * A mark whose icon says something the word does not stays, listed here with
 * what it says. A tone mark (`CalloutCard`, `KeyTakeawaysCard`) is no
 * `SectionLabel` and is not held here: its icon carries the tone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blankComments } from '../../../scripts/check-static-utility-modifiers.mjs'

const ROOT = __dirname

const KEPT: Record<string, string> = {
  // The label is the verdict's subject („Feuerwiderstand tragender Bauteile");
  // the gavel says that what follows is a ruling, which the subject does not.
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
