/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { buildComplianceBcf, type BcfModelRef } from './bcf'
import { readZipEntries } from '@/test-utils/read-zip'
import type { BimRuleResultWithConfirmation } from './rules'

const MODEL: BcfModelRef = {
  id: 'model-3',
  filename: 'Haus-A_V3.ifc',
  ifcProjectGlobalId: '0Yl3Uz1Kv9wxKQ8bqZ3aB1',
  updatedAt: new Date('2026-05-04T09:30:15.400Z'),
}

function result(overrides: Partial<BimRuleResultWithConfirmation> = {}): BimRuleResultWithConfirmation {
  return {
    ruleId: 'oib2-fire-resistance-load-bearing',
    richtlinie: 'OIB 2',
    clause: '3.1',
    titleDe: 'Feuerwiderstand tragender Bauteile',
    thresholdDe: 'Mindestens REI 60 in Gebäudeklasse 4',
    applicable: true,
    passed: 12,
    failed: 1,
    undecidable: 2,
    failures: [
      {
        globalId: '2O2Fr$t4X7Zf8NOew3FLKU',
        name: 'Aussenwand Nord',
        storeyName: 'EG',
        status: 'fail',
        reading: 'REI 30 — gefordert REI 60',
      },
    ],
    unknowns: [
      {
        globalId: '1kTvXnbbzCWw8lcMd1dR4o',
        name: 'Innenwand 12',
        storeyName: 'OG1',
        status: 'undecidable',
        reading: 'kein FireRating veröffentlicht',
      },
      {
        globalId: '0RSwXnbbzCWw8lcMd1dR9z',
        name: null,
        storeyName: null,
        status: 'undecidable',
        reading: 'kein FireRating veröffentlicht',
      },
    ],
    truncated: false,
    missing: [{ path: 'Pset_WallCommon.FireRating', elements: 2 }],
    confirmation: null,
    confirmationStale: false,
    ...overrides,
  }
}

const build = (results: BimRuleResultWithConfirmation[], projectId = 'project-1'): ReturnType<typeof buildComplianceBcf> =>
  buildComplianceBcf({
    projectId,
    projectName: 'Wohnhaus Grüngasse',
    model: MODEL,
    results,
    author: 'planer@example.at',
  })

describe('buildComplianceBcf', () => {
  it('writes a BCF 2.1 archive with one topic folder per open requirement', () => {
    const export_ = build([result()])
    const files = readZipEntries(export_.bytes)
    const paths = [...files.keys()]

    expect(export_.topics).toBe(1)
    expect(paths[0]).toBe('bcf.version')
    expect(files.get('bcf.version')).toContain('VersionId="2.1"')
    expect(paths.filter((path) => path.endsWith('/markup.bcf'))).toHaveLength(1)
    expect(paths.filter((path) => path.endsWith('/viewpoint.bcfv'))).toHaveLength(1)
    const folder = paths[1].replace(/\/$/, '')
    expect(folder).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(files.get(`${folder}/markup.bcf`)).toContain(`<Topic Guid="${folder}"`)
  })

  it('names the file after the project and the revision it was run against', () => {
    expect(build([result()]).filename).toBe('compliance-checks-Wohnhaus-Gruengasse-2026-05-04.bcfzip')
  })

  it('keeps the topic guid stable across revisions of the same project', () => {
    const rev3 = [...readZipEntries(build([result()]).bytes).keys()][1]
    const rev4 = [
      ...readZipEntries(
        buildComplianceBcf({
          projectId: 'project-1',
          projectName: 'Wohnhaus Grüngasse',
          model: { ...MODEL, id: 'model-4', filename: 'Haus-A_V4.ifc' },
          results: [result({ failed: 3 })],
          author: 'planer@example.at',
        }).bytes
      ).keys(),
    ][1]

    expect(rev4).toBe(rev3)
  })

  it('gives two projects different topic guids for the same rule', () => {
    const a = [...readZipEntries(build([result()], 'project-1').bytes).keys()][1]
    const b = [...readZipEntries(build([result()], 'project-2').bytes).keys()][1]

    expect(a).not.toBe(b)
  })

  it('is byte-identical for an unchanged ledger', () => {
    expect(build([result()]).bytes).toEqual(build([result()]).bytes)
  })

  it('selects every flagged element, failures first, without duplicates', () => {
    const files = readZipEntries(build([result()]).bytes)
    const viewpoint = [...files.entries()].find(([path]) => path.endsWith('.bcfv'))?.[1] ?? ''
    const ids = [...viewpoint.matchAll(/IfcGuid="([^"]+)"/g)].map((match) => match[1])

    expect(ids).toEqual(['2O2Fr$t4X7Zf8NOew3FLKU', '1kTvXnbbzCWw8lcMd1dR4o', '0RSwXnbbzCWw8lcMd1dR9z'])
    expect(viewpoint).toContain('<Visibility DefaultVisibility="true" />')
  })

  it('carries the threshold, the clause and the missing property into the description', () => {
    const files = readZipEntries(build([result()]).bytes)
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('Anforderung: Mindestens REI 60 in Gebäudeklasse 4')
    expect(markup).toContain('Quelle: OIB 2, Punkt 3.1')
    expect(markup).toContain('Revision: Haus-A_V3.ifc (2026-05-04)')
    expect(markup).toContain('Ergebnis: 12 erfüllt, 1 nicht erfüllt, 2 nicht entscheidbar.')
    expect(markup).toContain('- Aussenwand Nord (EG): REI 30 — gefordert REI 60')
    expect(markup).toContain('- Pset_WallCommon.FireRating (2 Bauteile)')
    expect(markup).toContain('- 0RSwXnbbzCWw8lcMd1dR9z: kein FireRating veröffentlicht')
  })

  it('escapes XML rather than emitting a file no reader can parse', () => {
    const files = readZipEntries(
      build([
        result({
          titleDe: 'Wand "A" & <B>',
          failures: [
            {
              globalId: '3aB9Kz1Uv7wxKQ8bqZ3aB2',
              name: 'Trennwand <EG> & "Flur"',
              storeyName: null,
              status: 'fail',
              reading: "0,80 m < 0,90 m 'gefordert'",
            },
          ],
        }),
      ]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('Wand &quot;A&quot; &amp; &lt;B&gt;')
    expect(markup).toContain('Trennwand &lt;EG&gt; &amp; &quot;Flur&quot;')
    expect(markup).toContain('&apos;gefordert&apos;')
    expect(markup).not.toMatch(/<B>/)
  })

  it('strips control characters XML cannot represent at all', () => {
    const files = readZipEntries(
      build([
        result({
          failures: [
            {
              globalId: '3aB9Kz1Uv7wxKQ8bqZ3aB2',
              name: 'Wand\u0000\u000b12',
              storeyName: null,
              status: 'fail',
              reading: 'REI 30',
            },
          ],
        }),
      ]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('- Wand12: REI 30')
    expect(markup).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
  })

  it('raises a failing rule as a high-priority Issue and an undecidable one as a Request', () => {
    const failing = readZipEntries(build([result()]).bytes)
    const failingMarkup = [...failing.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''
    expect(failingMarkup).toContain('TopicType="Issue"')
    expect(failingMarkup).toContain('TopicStatus="Open"')
    expect(failingMarkup).toContain('<Priority>High</Priority>')
    expect(failingMarkup).toContain('(nicht erfüllt)')

    const unknown = readZipEntries(build([result({ failed: 0, failures: [] })]).bytes)
    const unknownMarkup = [...unknown.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''
    expect(unknownMarkup).toContain('TopicType="Request"')
    expect(unknownMarkup).toContain('<Priority>Normal</Priority>')
    expect(unknownMarkup).toContain('(nicht entscheidbar)')
  })

  it('closes a topic a current confirmation covers and carries the note as a comment', () => {
    const files = readZipEntries(
      build([
        result({
          confirmation: {
            ruleId: 'oib2-fire-resistance-load-bearing',
            modelId: 'model-3',
            confirmedBy: 'brandschutz@example.at',
            note: 'Gutachten Kraus vom 12.03. liegt vor',
            confirmedAt: '2026-05-05T08:00:00.000Z',
          },
          confirmationStale: false,
        }),
      ]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('TopicStatus="Closed"')
    expect(markup).toContain('<Author>brandschutz@example.at</Author>')
    expect(markup).toContain('<Date>2026-05-05T08:00:00Z</Date>')
    expect(markup).toContain('Gutachten Kraus vom 12.03. liegt vor')
    expect(markup).not.toContain('ANDERE Modellrevision')
  })

  it('leaves a topic open when the confirmation was made about another revision', () => {
    const files = readZipEntries(
      build([
        result({
          confirmation: {
            ruleId: 'oib2-fire-resistance-load-bearing',
            modelId: 'model-2',
            confirmedBy: 'brandschutz@example.at',
            note: null,
            confirmedAt: '2026-01-05T08:00:00.000Z',
          },
          confirmationStale: true,
        }),
      ]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('TopicStatus="Open"')
    expect(markup).toContain('ANDERE Modellrevision')
  })

  it('puts a free-text note last so nothing reads as part of it', () => {
    const files = readZipEntries(
      build([
        result({
          confirmation: {
            ruleId: 'oib2-fire-resistance-load-bearing',
            modelId: 'model-2',
            confirmedBy: 'brandschutz@example.at',
            note: 'Gutachten liegt vor',
            confirmedAt: '2026-01-05T08:00:00.000Z',
          },
          confirmationStale: true,
        }),
      ]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('exportierten Stand. Anmerkung: Gutachten liegt vor</Comment>')
  })

  it('says the remainder is a floor when the rule itself capped its rows', () => {
    const files = readZipEntries(build([result({ failed: 40, truncated: true })]).bytes)
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('mindestens 39 weitere')
  })

  it('counts exactly when nothing was capped', () => {
    const files = readZipEntries(build([result({ failed: 5, truncated: false })]).bytes)
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('… 4 weitere')
    expect(markup).not.toContain('mindestens')
  })

  it('lists at most twelve verdicts in a topic, and counts the rest', () => {
    const failures = Array.from({ length: 15 }, (_, index) => ({
      globalId: `2O2Fr$t4X7Zf8NOew3FLK${index}`,
      name: `Wand ${index}`,
      storeyName: 'EG',
      status: 'fail' as const,
      reading: 'REI 30 — gefordert REI 60',
    }))
    const files = readZipEntries(
      build([result({ failed: 15, truncated: false, failures })]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''
    const description = markup.slice(markup.indexOf('<Description>'), markup.indexOf('</Description>'))

    expect(description.match(/- Wand /g)).toHaveLength(12)
    expect(markup).toContain('… 3 weitere')
  })

  it('skips rules that pass, that are out of scope, and that have nothing to check', () => {
    const export_ = build([
      result({ ruleId: 'clean', failed: 0, undecidable: 0, failures: [], unknowns: [] }),
      result({ ruleId: 'out-of-scope', applicable: false }),
      result({ ruleId: 'empty', passed: 0, failed: 0, undecidable: 0, failures: [], unknowns: [] }),
    ])

    expect(export_.topics).toBe(0)
    expect([...readZipEntries(export_.bytes).keys()]).toEqual(['bcf.version'])
  })

  it('omits the viewpoint when the rule flagged no element it can name', () => {
    const files = readZipEntries(
      build([result({ failed: 3, failures: [], undecidable: 0, unknowns: [] })]).bytes
    )
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect([...files.keys()].some((path) => path.endsWith('.bcfv'))).toBe(false)
    expect(markup).not.toContain('<Viewpoints')
  })

  it('omits IfcProject rather than writing an empty Guid', () => {
    const files = readZipEntries(
      buildComplianceBcf({
        projectId: 'project-1',
        projectName: 'Wohnhaus',
        model: { ...MODEL, ifcProjectGlobalId: null },
        results: [result()],
        author: 'planer@example.at',
      }).bytes
    )
    const markup = [...files.entries()].find(([p]) => p.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).not.toContain('IfcProject=')
    expect(markup).toContain('<File isExternal="true">')
  })

  it('selects only ids a CAD can resolve', () => {
    const files = readZipEntries(
      build([
        result({
          unknowns: [
            {
              globalId: 'express:4211',
              name: 'Ohne GlobalId',
              storeyName: null,
              status: 'undecidable',
              reading: 'kein FireRating',
            },
          ],
        }),
      ]).bytes
    )
    const viewpoint = [...files.entries()].find(([p]) => p.endsWith('.bcfv'))?.[1] ?? ''
    const markup = [...files.entries()].find(([p]) => p.endsWith('markup.bcf'))?.[1] ?? ''

    expect(viewpoint).not.toContain('express:4211')
    expect([...viewpoint.matchAll(/IfcGuid="([^"]+)"/g)].map((m) => m[1])).toEqual(['2O2Fr$t4X7Zf8NOew3FLKU'])
    expect(markup).toContain('Ohne GlobalId')
  })

  it('carries a folder entry per topic, as the encoding guide requires', () => {
    const paths = [...readZipEntries(build([result()]).bytes).keys()]
    const folder = paths.find((p) => p.endsWith('/'))

    expect(folder).toBeDefined()
    expect(paths).toContain(`${folder}markup.bcf`)
  })

  it('names the model revision in the markup header so the topic is anchored', () => {
    const files = readZipEntries(build([result()]).bytes)
    const markup = [...files.entries()].find(([path]) => path.endsWith('markup.bcf'))?.[1] ?? ''

    expect(markup).toContain('IfcProject="0Yl3Uz1Kv9wxKQ8bqZ3aB1"')
    expect(markup).toContain('<Filename>Haus-A_V3.ifc</Filename>')
    expect(markup).toContain('<CreationDate>2026-05-04T09:30:15Z</CreationDate>')
    expect(markup).toContain('<CreationAuthor>planer@example.at</CreationAuthor>')
  })

  it('falls back to a usable filename when the project has no name', () => {
    const export_ = buildComplianceBcf({
      projectId: 'project-1',
      projectName: null,
      model: MODEL,
      results: [result()],
      author: 'planer@example.at',
    })

    expect(export_.filename).toBe('compliance-checks-project-2026-05-04.bcfzip')
  })

  it('spells an Austrian project name instead of punching holes in it', () => {
    const named = (projectName: string) =>
      buildComplianceBcf({
        projectId: 'project-1',
        projectName,
        model: MODEL,
        results: [result()],
        author: 'planer@example.at',
      }).filename

    expect(named('Beispielstraße 14')).toBe('compliance-checks-Beispielstrasse-14-2026-05-04.bcfzip')
    expect(named('Grünanger Höfe')).toBe('compliance-checks-Gruenanger-Hoefe-2026-05-04.bcfzip')
    expect(named('ÖBB Ärztezentrum')).toBe('compliance-checks-OeBB-Aerztezentrum-2026-05-04.bcfzip')
    expect(named('Grünanger'.normalize('NFD'))).toBe('compliance-checks-Gruenanger-2026-05-04.bcfzip')
    expect(named('Rezidence Dvořák')).toBe('compliance-checks-Rezidence-Dvorak-2026-05-04.bcfzip')
    expect(named('日本橋')).toBe('compliance-checks-project-2026-05-04.bcfzip')
    expect(named('Øresund Łódź')).toBe('compliance-checks-Oeresund-Lodz-2026-05-04.bcfzip')
  })
})
