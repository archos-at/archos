/**
 * @vitest-environment node
 */
/**
 * Inside a residency cell a WorkOS audit event carries salted hashes, never a
 * document's or project's name (ADR-0167); without the salt the names are
 * withheld; outside a cell nothing changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAME_HASH_PREFIX, nameHash, residencyAuditMetadata } from './audit-names'

const EVENT = {
  filename: 'Gehaltsliste 2026.xlsx',
  documentId: 'doc_1',
  terms: 'gehalt',
  name: 'Projekt Wien',
}

describe('residencyAuditMetadata', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('leaves the metadata alone outside a cell (positive control)', () => {
    vi.stubEnv('AUDIT_NAME_SALT', 'salt')
    expect(residencyAuditMetadata('org_1', EVENT)).toEqual(EVENT)
  })

  it('hashes every name inside a cell and keeps the ids', () => {
    vi.stubEnv('RESIDENCY_CELL', 'eu-at-1')
    vi.stubEnv('AUDIT_NAME_SALT', 'salt')
    const out = residencyAuditMetadata('org_1', EVENT)
    expect(out.documentId).toBe('doc_1')
    for (const key of ['filename', 'terms', 'name'] as const) {
      expect(String(out[key]).startsWith(NAME_HASH_PREFIX)).toBe(true)
      expect(out[key]).not.toContain(EVENT[key])
    }
    expect(JSON.stringify(out)).not.toMatch(/Gehalt|gehalt|Wien/)
    expect(out.filename).toBe(nameHash('salt', 'org_1', EVENT.filename))
  })

  it('hashes one name differently for two organizations', () => {
    expect(nameHash('salt', 'org_1', 'a.pdf')).not.toBe(nameHash('salt', 'org_2', 'a.pdf'))
  })

  it('withholds the names inside a cell when no salt is configured (fail closed)', () => {
    vi.stubEnv('RESIDENCY_CELL', 'eu-at-1')
    vi.stubEnv('AUDIT_NAME_SALT', '')
    expect(residencyAuditMetadata('org_1', EVENT)).toEqual({
      documentId: 'doc_1',
      nameWithheld: true,
    })
  })
})
