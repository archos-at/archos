import type { ProposedRecord } from './wire'

export function territoriesFromIso(rows: readonly { code: string; name: string; parent?: string; quote?: string }[], captureId: string): ProposedRecord[] {
  return rows.map((row) => {
    const subdivision = row.code.includes('-')
    const parent = row.parent ?? (subdivision ? row.code.slice(0, 2) : undefined)
    return {
      type: 'territory',
      id: row.code,
      kind: subdivision ? 'state' : 'country',
      name: row.name,
      parents: parent ? [{ id: parent, validFrom: null, validTo: null }] : [],
      aliases: {},
      validFrom: null,
      validTo: null,
      coverageLevel: null,
      municipalLaw: null,
      zone: null,
      citations: [{ captureId, quote: row.quote ?? `${row.code} ${row.name}` }],
    }
  })
}
