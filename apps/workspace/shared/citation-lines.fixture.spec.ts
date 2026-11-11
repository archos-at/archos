/**
 * @vitest-environment node
 *
 * One fixture of citations, and the line each country's style record gives them
 * per language (country-as-data plan row 6). Each style is read from its record as
 * the door reads a proposal, and each line is checked on every surface that writes
 * one: the chip's copy, the copy-all export and the evidence an outside agent reads.
 * No country is named here; the fixture says which record and which language.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sharing/registry', () => ({
  describeResource: () => ({ deepLink: (id: string) => `/app/chat?session=${id}` }),
}))

import { proposedRecordSchema } from '@/lib/base-knowledge/platform/wire'
import { answerEvidence } from '@/lib/agent-asks/answer-evidence'
import { buildCitationModel, type CitationRef } from '@/features/chat/lib/citations'
import { encodeCitations } from '@/features/chat/lib/citations/persistence'
import { renderCitations } from '@/features/chat/lib/citation-export'
import { toQuoteList, toTechnicalText } from '@/features/chat/lib/source-citation'
import type { CitationSource } from '@/features/chat/types'
import { FALLBACK_CITATION_STYLES, type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'

interface Expected {
  line: string
  quote: string
}
interface Case {
  /** The pack holding the style record, from `apps/workspace`. */
  pack: string
  language: string
  lines: Record<string, Expected>
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as T
const FIXTURE = 'tests/fixtures/citation-lines'
const { now, cases } = readJson<{ now: string; cases: Case[] }>(`${FIXTURE}/lines.json`)
const NOW = new Date(now)
const citations = readJson<(Omit<CitationSource, 'timestamp'> & { id: string; number: number })[]>(`${FIXTURE}/citations.json`)

/** The pack's citation style, parsed as a proposal of it is. */
function stylesIn(pack: string): CitationStylePayload | undefined {
  const records = proposedRecordSchema.array().parse(readJson<{ records: unknown[] }>(pack).records)
  for (const record of records) {
    if (record.type === 'ruleset' && record.values.body.kind === 'citation_style') return record.values.body.payload
  }
  return undefined
}

const sourceIn = (citation: (typeof citations)[number], language: string): CitationSource => ({
  ...citation,
  timestamp: NOW,
  line: { language },
})

const refOf = (source: CitationSource): CitationRef => {
  const [document] = buildCitationModel({ citations: [source] })
  if (!document) throw new Error(`${source.id} produced no document`)
  return { document, locus: document.loci[0] }
}

describe.each(cases)('$pack in $language', ({ pack, language, lines }) => {
  const styles = stylesIn(pack)
  const sources = citations.map((citation) => sourceIn(citation, language))

  it('is a citation style record, and the fixture states a line for every citation', () => {
    expect(styles).toBeDefined()
    expect(Object.keys(lines).sort()).toEqual(citations.map(({ id }) => id).sort())
  })

  it.each(sources.map((source) => [source.id, source] as const))('the chip copies %s in its form', (id, source) => {
    const ref = refOf(source)
    expect(toTechnicalText(ref, NOW, styles)).toBe(lines[id].line)
    expect(toQuoteList([ref], NOW, styles)).toBe(lines[id].quote)
  })

  it('the export lists every line, numbered as the answer cites it', async () => {
    const refs = sources.map(refOf)
    const numbered = sources.map((source) => `[${source.number}] ${lines[source.id].line}`).join('\n')
    expect(await renderCitations(refs, 'fachtext', NOW, styles)).toBe(numbered)
  })

  it.each(sources.map((source) => [source.id, source] as const))('an outside agent reads the line of %s', (id, source) => {
    const evidence = answerEvidence(
      { metadata: { citations: encodeCitations([source]) }, createdAt: NOW },
      { conversationId: 's_1', projectId: null, styles }
    )
    expect(evidence.sources?.map(({ citation }) => citation)).toEqual([lines[id].line])
  })
})

describe('the fallback style', () => {
  it('is the payload of a country pack’s record, so a released record changes no line (delete after rollover)', () => {
    const packs = readdirSync(join(process.cwd(), '../../configs/knowledge-packs')).filter((name) => name.endsWith('.json'))
    const payloads = packs.map((name) => stylesIn(`../../configs/knowledge-packs/${name}`)).filter(Boolean)
    expect(payloads).toContainEqual(FALLBACK_CITATION_STYLES)
  })

  it('writes the line where no style is released', () => {
    const [source] = citations.map((citation) => sourceIn(citation, 'und'))
    const ref = refOf(source)
    expect(toTechnicalText(ref, NOW)).toBe(toTechnicalText(ref, NOW, FALLBACK_CITATION_STYLES))
  })
})
