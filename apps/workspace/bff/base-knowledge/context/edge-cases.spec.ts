// @disk-inputs: ../../evals/base-knowledge/edge_cases.yaml
/**
 * @vitest-environment node
 *
 * The edge cases of design §9 on paper (`evals/base-knowledge/edge_cases.yaml`):
 * each case's records, office and site through the resolver a turn uses
 * (`./resolve.ts`), and the gate, retrieval and uses it must give. A case
 * the file adds runs here without a line of code.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { z } from 'zod'
import { graphFromProposals } from '../chain/from-proposals'
import type { KnowledgeGraph } from '../chain/graph'
import { proposedRecordSchema } from '../platform/wire'
import { capText, resolveKnowledgeContext } from './resolve'
import { GATE_STATES, MAX_CONTEXT_TEXT_CHARS } from './wire'

const FILE = join(process.cwd(), '..', '..', 'evals', 'base-knowledge', 'edge_cases.yaml')

const useExpectation = z
  .object({
    role: z.string().optional(),
    qualifier: z.string().nullable().optional(),
    editionId: z.string().nullable().optional(),
    labels: z.array(z.string()).optional(),
    freshness: z.string().optional(),
  })
  .strict()

const caseSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    graphs: z.array(z.string()).default([]),
    records: z.array(z.unknown()).default([]),
    office: z.object({ homeCountry: z.string().nullable(), entitled: z.array(z.string()) }).strict(),
    site: z.object({ territoryId: z.string(), certainty: z.enum(['verified', 'unverified']) }).strict().nullable(),
    date: z.iso.date().default('2026-12-14'),
    checks: z.record(z.string(), z.object({ checkedAt: z.string(), result: z.string() }).strict()).default({}),
    expect: z
      .object({
        gate: z.enum(GATE_STATES),
        reason: z.string().optional(),
        municipalLaw: z.boolean().optional(),
        retrieval: z.array(z.string()).optional(),
        noUses: z.boolean().optional(),
        uses: z.record(z.string(), useExpectation).optional(),
        absentWorks: z.array(z.string()).optional(),
        /** Words the chain text must carry, and must not: the text says what the uses say. */
        textContains: z.array(z.string()).optional(),
        textLacks: z.array(z.string()).optional(),
        undetermined: z.array(z.object({ workId: z.string(), reason: z.string() })).optional(),
      })
      .strict(),
  })
  .strict()

const fileSchema = z.object({ graphs: z.record(z.string(), z.array(z.unknown())), cases: z.array(caseSchema).min(1) }).strict()

const file = fileSchema.parse(parse(readFileSync(FILE, 'utf8')))

function graphOf(edgeCase: z.infer<typeof caseSchema>): KnowledgeGraph {
  const records = [...edgeCase.graphs.flatMap((name) => file.graphs[name] ?? []), ...edgeCase.records].map((record) =>
    proposedRecordSchema.parse(record),
  )
  const graph = graphFromProposals(records)
  for (const [editionId, check] of Object.entries(edgeCase.checks)) {
    const edition = graph.editions.get(editionId)
    if (!edition) throw new Error(`${edgeCase.id}: no edition ${editionId}`)
    ;(graph.editions as Map<string, typeof edition>).set(editionId, { ...edition, lastCheck: check })
  }
  return graph
}

describe('the edge cases of country base knowledge', () => {
  it('names each case once, with every graph it reads', () => {
    const ids = file.cases.map((edgeCase) => edgeCase.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
    for (const edgeCase of file.cases) for (const name of edgeCase.graphs) expect(file.graphs, edgeCase.id).toHaveProperty(name)
  })

  it.each(file.cases.map((edgeCase) => [edgeCase.id, edgeCase] as const))('%s', (_id, edgeCase) => {
    const context = resolveKnowledgeContext({
      homeCountry: edgeCase.office.homeCountry,
      entitled: new Set(edgeCase.office.entitled),
      sites: edgeCase.site ? [edgeCase.site] : [],
      graph: graphOf(edgeCase),
      truncated: false,
      date: edgeCase.date,
      now: new Date(`${edgeCase.date}T12:00:00Z`),
      procedures: [],
      packSeqs: {},
    })
    const want = edgeCase.expect
    expect(context.gate.state, edgeCase.title).toBe(want.gate)
    if (want.reason) expect(context.gate.reason).toBe(want.reason)
    if (want.municipalLaw !== undefined) expect(context.gate.leaves[0]?.municipalLaw).toBe(want.municipalLaw)
    if (want.retrieval) expect(context.retrieval.countries).toEqual(want.retrieval)
    if (want.noUses) expect(context.uses).toEqual([])
    for (const [workId, expected] of Object.entries(want.uses ?? {})) {
      const use = context.uses.find((candidate) => candidate.workId === workId)
      expect(use, `${edgeCase.id}: a use of ${workId}`).toBeDefined()
      expect(use).toMatchObject(expected)
    }
    for (const workId of want.absentWorks ?? []) expect(context.uses.map((use) => use.workId)).not.toContain(workId)
    if (want.undetermined) expect(context.undetermined).toEqual(want.undetermined)
    for (const words of want.textContains ?? []) expect(context.text, edgeCase.id).toContain(words)
    for (const words of want.textLacks ?? []) expect(context.text ?? '', edgeCase.id).not.toContain(words)
  })
})

describe('the chain text’s bound', () => {
  it('cuts a text past the wire’s bound at a line, and says it was cut', () => {
    const long = Array.from({ length: 400 }, (_, index) => `- line ${index} ${'x'.repeat(60)}`).join('\n')
    const capped = capText(long)
    expect(capped.length).toBeLessThanOrEqual(MAX_CONTEXT_TEXT_CHARS)
    expect(capped).toMatch(/x\n\[The rest of the building law at this site is cut; ask about one instrument by name\.\]$/)
    // Every line before the note is a whole line of the original: the cut never splits one.
    const kept = capped.split('\n').slice(0, -1)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept).toEqual(long.split('\n').slice(0, kept.length))
    expect(capText('short')).toBe('short')
  })
})
