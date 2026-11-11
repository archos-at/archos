/**
 * ISO 3166 rows as territory records (ADR-0165, design §3.2). Pure. A code
 * without a subdivision is a country; `AT-6` is a state whose parent is the
 * row's own `parent`, else its country. Names are the file's; each row cites
 * the capture of the list with its own words (its `quote`, else "<code> <name>"),
 * which KC-6 checks (ADR-0170).
 */

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
      // An imported territory states no coverage: it reads `none` until a reviewed change says more (ADR-0173).
      coverageLevel: null,
      municipalLaw: null,
      citations: [{ captureId, quote: row.quote ?? `${row.code} ${row.name}` }],
    }
  })
}
