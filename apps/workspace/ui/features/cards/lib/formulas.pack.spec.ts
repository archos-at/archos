// @disk-inputs: ../../configs/knowledge-packs/at.json
/**
 * @vitest-environment node
 *
 * The formula checks against the records they cite: every bound names a work
 * and an edition the Austria pack holds, by the designation and label the
 * server's `site_binding` stamp carries. A check whose pair the pack does not
 * hold could never match the stamp, so its card would show a hint at every
 * site and nothing would say why. The labels are the interim key until the
 * checks carry edition ids, as in `bff/bim/rule-basis.pack.spec.ts`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proposedRecordSchema } from '@/lib/base-knowledge/platform/wire'
import { answerCardSchema } from '@/shared/cards/schemas'
import cases from './formula-cases.json'
import { compileFormula, sourceValues, type FormulaCardData, type FormulaValues, type FormulaWords } from './formulas'

const AT = proposedRecordSchema
  .array()
  .parse(JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'configs', 'knowledge-packs', 'at.json'), 'utf8')).records)

const words: FormulaWords = { line: (key) => key, term: (key) => key }

type Case = { id: string; card?: unknown; base?: string; overrides?: FormulaValues }
const all = (cases as unknown as { cases: Case[] }).cases
const cardOf = (entry: Case): FormulaCardData =>
  answerCardSchema.parse(entry.card ?? all.find((other) => other.id === entry.base)?.card) as FormulaCardData

/** Every (designation, edition label) a check of a fixture case cites, over every rule and case. */
const cited = (): Map<string, string> => {
  const pairs = new Map<string, string>()
  for (const entry of all) {
    const card = cardOf(entry)
    const compiled = compileFormula(card.formula, { ...sourceValues(card.formula), ...entry.overrides }, words)
    for (const check of compiled.checks) {
      const { document, edition } = check.reference
      pairs.set(`${document}|${edition}`, `${entry.id}: ${check.id}`)
    }
  }
  return pairs
}

describe('the formula checks against the Austria pack', () => {
  it('cites, in every check, a work and an edition label the pack holds', () => {
    const works = new Map(AT.flatMap((record) => (record.type === 'work' ? [[record.designation, record.key] as const] : [])))
    const editions = new Set(AT.flatMap((record) => (record.type === 'edition' ? [`${record.workKey}|${record.label}`] : [])))
    const pairs = cited()
    expect(pairs.size).toBeGreaterThan(0)
    for (const [pair, where] of pairs) {
      const [designation, label] = pair.split('|')
      expect(works.has(designation), `${where}: no work ${designation}`).toBe(true)
      expect(editions, `${where}: ${designation}, ${label}`).toContain(`${works.get(designation)}|${label}`)
    }
  })

  it('reaches every rule, so no rule’s checks go unchecked', () => {
    const rules = new Set(all.map((entry) => cardOf(entry).formula.name))
    expect([...rules].sort()).toEqual(['daylight_ratio', 'escape_route_length', 'stair_step_rule', 'u_value'])
  })
})
