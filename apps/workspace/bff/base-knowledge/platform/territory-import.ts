/**
 * ISO 3166 rows as territory records (ADR-0165, design §3.2). Pure. A code
 * without a subdivision is a country; `AT-6` is a state whose parent is the
 * row's own `parent`, else its country. Names are the file's, and each name
 * is the quote KC-6 checks against the capture of the list (ADR-0170).
 */

import type { ProposedRecord } from './wire'

export function territoriesFromIso(rows: readonly { code: string; name: string; parent?: string }[], captureId: string): ProposedRecord[] {
  return rows.map((row) => {
    const subdivision = row.code.includes('-')
    const parent = row.parent ?? (subdivision ? row.code.slice(0, 2) : undefined)
    return {
      type: 'territory',
      id: row.code,
      kind: subdivision ? 'state' : 'country',
      name: row.name,
      parentIds: parent ? [parent] : [],
      aliases: {},
      validFrom: null,
      validTo: null,
      citations: [{ captureId, quote: row.name }],
    }
  })
}
