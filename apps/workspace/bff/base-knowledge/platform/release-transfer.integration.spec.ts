/**
 * @vitest-environment node
 *
 * A country's release moved between deployments (rollover-to-prod, step 2) against two REAL Postgres databases,
 * fresh copies of the migrated schema, one per deployment, as `scripts/rls-test-db.sh` makes them:
 *
 *   TEST_RELEASE_SOURCE_DATABASE_URL=postgres://app_rw@host:port/<the source copy> \
 *   TEST_RELEASE_TARGET_DATABASE_URL=postgres://app_rw@host:port/<the target copy> \
 *     npx vitest run bff/base-knowledge/platform/release-transfer.integration.spec.ts
 *
 * On the source, the synthetic union XB and country XA (whose territory lies in XB) are reviewed and published to
 * stable. Exported, XA's bundle is refused by the empty target while XB is not released there; XB imported,
 * reviewed and published there, XA imports into a draft that validates green once its text's same bytes are
 * attached, with records equal to the source's. The import approves nothing: the draft waits for a person to check
 * every imported page against its source. The same bundle again changes nothing; other bytes are refused.
 *
 * Faked, because they are outside the database: WorkOS (the operators' permissions), the audit trail, and each
 * deployment's base corpus (the backend's), which holds files by name and sha256.
 */

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ platformOrg: 'org_platform_release_transfer' }))
/** Each deployment's base corpus: file name to sha256. */
const corpora = vi.hoisted(() => ({ source: new Map<string, string>(), target: new Map<string, string>(), current: 'source' as 'source' | 'target' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/authz/platform')>()
  return {
    ...real,
    getPlatformOrganizationId: async () => fixed.platformOrg,
    requirePlatformPermission: async (session: { permissions?: string[] } | null, permission: string) => {
      if (!session?.permissions?.includes(permission)) throw new real.PlatformAccessDeniedError(`Platform permission required: ${permission}`)
    },
  }
})
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseStatus: async () => ({
    files: [...corpora[corpora.current]].map(([fileName, currentSha256]) => ({ fileName, currentSha256, state: 'ingested' })),
  }),
  uploadKnowledgeBaseDocument: async (file: File) => {
    corpora[corpora.current].set(file.name, createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'))
    return { status: 'pending', message: '' }
  },
}))

const SOURCE_URL = process.env.TEST_RELEASE_SOURCE_DATABASE_URL
const TARGET_URL = process.env.TEST_RELEASE_TARGET_DATABASE_URL
const MANAGE = ['platform:settings:view', 'platform:knowledge:write', 'platform:knowledge:review']
const person = (userId: string, permissions: string[]) =>
  ({ userId, email: `${userId}@example.com`, organizationId: fixed.platformOrg, permissions }) as unknown as UserSession
const author = person('user_release_author', MANAGE)
const expert = person('user_release_expert', [...MANAGE, 'platform:knowledge:approve_as_domain_expert'])
const importer = person('user_release_importer', MANAGE)
const prodExpert = person('user_release_prod_expert', [...MANAGE, 'platform:knowledge:approve_as_domain_expert'])

const PDF = Buffer.from('%PDF-1.7 Building Code of Xanadu, edition 2026')
const PDF_SHA = createHash('sha256').update(PDF).digest('hex')
const TEXT_KEY = 'xa-building-code-2026-pdf'
const TEXT_URL = 'https://gazette.xa.example/building-code-2026.pdf'
const PAGE = 'XA Republic of Xanadu\nBuilding Code of Xanadu, edition 2026\n§ 1 This code applies to every building in Xanadu.'
const UNION_PAGE = 'XB Union of Xanadu and Beyond (a user-assigned code, for testing)'

describe('the release transfer suite is not silently skipped in CI', () => {
  it('has two databases to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(SOURCE_URL && TARGET_URL, 'TEST_RELEASE_*_DATABASE_URL unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!SOURCE_URL || !TARGET_URL)('a country’s release, exported on one deployment and imported as a draft on another', () => {
  let store: typeof import('./store')
  let release: typeof import('./release')
  let transfer: typeof import('./release-transfer')
  let onboarding: typeof import('./onboarding')
  let texts: typeof import('./texts')
  let wire: typeof import('./wire')
  let captures: typeof import('./captures')
  let textFileName: typeof import('./text-wire').textFileName
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let db: typeof import('@/lib/db')

  /** Point every module at one deployment's database and corpus. */
  async function on(deployment: 'source' | 'target') {
    await db.closeDb()
    process.env.APP_DATABASE_URL = deployment === 'source' ? SOURCE_URL : TARGET_URL
    corpora.current = deployment
  }

  const rows = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    withPlatformAccess('release transfer spec', async () => [...(await db.getDb().execute<T>(query))])

  /** Every claim accepted, its source checked, by a person who wrote nothing in it; approved; published to stable. */
  async function reviewAndPublish(id: string, by: UserSession) {
    const view = await store.readChangeRequest(id)
    await store.platformTransaction(async (tx) => {
      const decisions = view!.revisions.flatMap((revision) =>
        revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const, sourceChecked: true })),
      )
      await store.insertReviewDecisions(tx, id, { by: by.userId, decisionSource: 'app' }, decisions)
      await store.insertApproval(tx, { changeRequestId: id, approver: by.userId, role: 'domain_expert', decisionSource: 'app' })
      await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
    })
    await release.publishChangeRequest(id, 'preview', { by: by.userId, decisionSource: 'app' })
    await release.publishChangeRequest(id, 'stable', { by: by.userId, decisionSource: 'app' })
  }

  const submit = (id: string) => store.platformTransaction((tx) => store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt'))

  /** A request on the source deployment: a pasted page, the records citing it, validated green, submitted, published. */
  async function onboard(countryId: string, page: string, records: (captureId: string) => unknown[], text?: { key: string }) {
    const id = await store.insertChangeRequest({ title: `${countryId} on the source`, countryId, createdBy: author.userId })
    const captured = await onboarding.capturePlatformCitation(author, id, { basis: 'operator_supplied', url: 'https://gazette.xa.example/', text: page })
    const proposals = records(captured.captureId).map((record) => wire.proposedRecordSchema.parse(record))
    await store.platformTransaction(async (tx) => {
      const request = await store.lockChangeRequest(tx, id)
      const plain = proposals.filter((record) => record.type !== 'manifestation')
      await store.insertProposedRecords(tx, request!, plain, { createdBy: author.userId, proposedBy: 'person' })
      for (const record of proposals.filter((one) => one.type === 'manifestation')) {
        // The text as text-import attaches it: fetched from its URL, under the name of its bytes.
        const fileName = textFileName(text!.key, PDF_SHA)
        await store.insertProposedRecords(tx, request!, [record], {
          createdBy: author.userId,
          proposedBy: 'person',
          text: { origin: 'url', fileName, sha256: PDF_SHA, bytes: PDF.length, pages: 1, sourceId: 'xa-gazette', sourceOrigin: 'released', url: TEXT_URL, attachedBy: author.userId, attachedAt: new Date().toISOString() },
        })
      }
    })
    expect(await onboarding.validatePlatformChangeRequest(author, id)).toMatchObject({ valid: true, problems: [] })
    await submit(id)
    await reviewAndPublish(id, expert)
    return id
  }

  const unionRecords = (captureId: string) => [
    { type: 'territory', id: 'XB', kind: 'union', name: 'Union of Xanadu and Beyond', citations: [{ captureId, quote: UNION_PAGE }] },
  ]
  const countryRecords = (captureId: string) => [
    { type: 'territory', id: 'XA', kind: 'country', name: 'Republic of Xanadu', parents: [{ id: 'XB' }], citations: [{ captureId, quote: 'XA Republic of Xanadu' }] },
    { type: 'work', key: 'xa-building-code', kind: 'statute', title: 'Building Code of Xanadu', territoryIds: ['XA'], citations: [{ captureId, quote: 'Building Code of Xanadu' }] },
    { type: 'edition', key: 'xa-building-code-2026', workKey: 'xa-building-code', label: 'edition 2026', citations: [{ captureId, quote: 'Building Code of Xanadu, edition 2026' }] },
    {
      type: 'manifestation',
      key: TEXT_KEY,
      editionKey: 'xa-building-code-2026',
      language: 'en',
      licenceClass: 'public_open',
      corpusFile: `${TEXT_KEY}-${PDF_SHA.slice(0, 12)}.pdf`,
      citations: [{ captureId, quote: 'This code applies to every building in Xanadu.' }],
    },
  ]

  /** A record as proposed, without the deployment's own capture ids. */
  const portable = (record: { citations: { captureId?: string }[] }) => ({ ...record, citations: record.citations.map(({ captureId: _id, ...rest }) => rest) })

  let unionBundle: Awaited<ReturnType<typeof transfer.exportCountryRelease>>
  let countryBundle: Awaited<ReturnType<typeof transfer.exportCountryRelease>>

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = SOURCE_URL
    db = await import('@/lib/db')
    withPlatformAccess = (await import('@/lib/db/tenant-context')).withPlatformAccess
    store = await import('./store')
    release = await import('./release')
    transfer = await import('./release-transfer')
    onboarding = await import('./onboarding')
    texts = await import('./texts')
    wire = await import('./wire')
    captures = await import('./captures')
    textFileName = (await import('./text-wire')).textFileName
    corpora.source.set(textFileName(TEXT_KEY, PDF_SHA), PDF_SHA)
    await onboard('XB', UNION_PAGE, unionRecords)
    await onboard('XA', PAGE, countryRecords, { key: TEXT_KEY })
  })

  afterAll(async () => {
    await db.closeDb()
  })

  it('exports a country’s stable release as one self-describing bundle, to a reviewer only', async () => {
    await expect(transfer.exportCountryRelease(person('user_release_viewer', ['platform:settings:view']), 'XA')).rejects.toThrow(/platform:knowledge:review/)
    countryBundle = await transfer.exportCountryRelease(author, 'XA')
    unionBundle = await transfer.exportCountryRelease(author, 'XB')

    expect(countryBundle).toMatchObject({ format: 'knowledge-release/1', countryId: 'XA', requires: [{ recordId: 'XB', countryId: 'XB' }] })
    expect(countryBundle.records.map((record) => record.type)).toEqual(['territory', 'work', 'edition', 'manifestation'])
    expect(countryBundle.captures).toEqual([expect.objectContaining({ basis: 'operator_supplied', text: PAGE, sha256: captures.sha256Of(PAGE) })])
    expect(countryBundle.texts).toEqual([{ manifestationKey: TEXT_KEY, fileName: textFileName(TEXT_KEY, PDF_SHA), sha256: PDF_SHA, url: TEXT_URL, sourceId: 'xa-gazette' }])
    // Reads only: the same release exports the same bundle.
    expect(await transfer.exportCountryRelease(author, 'XA')).toEqual(countryBundle)
    await expect(transfer.exportCountryRelease(author, 'XC')).rejects.toThrow(/no stable release/)
  })

  it('refuses a release that names a record the target has not released, and writes nothing', async () => {
    await on('target')
    await expect(transfer.importCountryRelease(importer, { bundle: countryBundle })).rejects.toMatchObject({ code: 'REFERENCE_NOT_RELEASED', details: { missing: ['XB'] } })
    expect(await rows(sql`SELECT id FROM knowledge_change_requests`)).toEqual([])
    expect(await rows(sql`SELECT id FROM knowledge_citation_captures`)).toEqual([])
  })

  it('takes the imports only from a writer, and imports the union first, reviewed and published on the target', async () => {
    await expect(transfer.importCountryRelease(person('user_release_viewer', ['platform:settings:view']), { bundle: unionBundle })).rejects.toThrow(/platform:knowledge:write/)
    const union = await transfer.importCountryRelease(importer, { bundle: unionBundle })
    expect(union).toMatchObject({ status: 'created', records: 1, captures: 1, texts: [] })
    expect(await onboarding.validatePlatformChangeRequest(importer, union.changeRequestId)).toMatchObject({ valid: true })
    await submit(union.changeRequestId)
    await reviewAndPublish(union.changeRequestId, prodExpert)
  })

  let draftId = ''

  it('imports the country into a draft, and nothing more: no approval, no release, every page still to be checked', async () => {
    const imported = await transfer.importCountryRelease(importer, { bundle: countryBundle }, 'agent')
    expect(imported).toMatchObject({ status: 'created', records: 4, captures: 1, texts: countryBundle.texts })
    draftId = imported.changeRequestId
    const view = await store.readChangeRequest(draftId)
    expect(view).toMatchObject({ status: 'draft', countryId: 'XA', createdBy: importer.userId, approvals: [], releases: [], sourcesUnchecked: true })
    // Not fetched here: an operator-supplied capture, holding the source's text and its sha256.
    expect(view!.captures).toEqual([expect.objectContaining({ basis: 'operator_supplied', countsAsFetched: false, sha256: countryBundle.captures[0]!.sha256 })])
    expect(view!.captures[0]!.note).toMatch(/Nobody fetched it here/)
  })

  it('answers the same bundle with the same draft, unchanged', async () => {
    const again = await transfer.importCountryRelease(importer, { bundle: countryBundle })
    expect(again).toMatchObject({ status: 'unchanged', changeRequestId: draftId })
    expect(await rows(sql`SELECT id FROM knowledge_change_requests WHERE country_id = 'XA'`)).toHaveLength(1)
    expect(await rows(sql`SELECT id FROM knowledge_citation_captures WHERE change_request_id = ${draftId}::uuid`)).toHaveLength(1)
  })

  it('validates green once the same bytes are attached, refusing other bytes, with records equal to the source’s', async () => {
    // The target's corpus does not hold the text yet: KC-1 names it.
    const before = await onboarding.validatePlatformChangeRequest(importer, draftId)
    expect(before.problems).toEqual([expect.objectContaining({ code: 'KC-1', pointer: '/corpusFile', recordId: `manifestation:${TEXT_KEY}` })])

    const other = new File([Buffer.from('%PDF-1.7 another text')], 'code.pdf', { type: 'application/pdf' })
    await expect(texts.uploadPlatformText(importer, draftId, TEXT_KEY, other)).rejects.toMatchObject({ code: 'TEXT_NOT_RELEASED' })
    const same = new File([PDF], 'code.pdf', { type: 'application/pdf' })
    expect(await texts.uploadPlatformText(importer, draftId, TEXT_KEY, same)).toMatchObject({ status: 'written', text: { sha256: PDF_SHA } })

    expect(await onboarding.validatePlatformChangeRequest(importer, draftId)).toMatchObject({ valid: true, records: 4, problems: [] })
    const proposals = await store.platformTransaction(async (tx) =>
      store.newestPerRecord(await store.requestRevisions(tx, draftId)).map((revision) => wire.proposedRecordSchema.parse(revision.provenance.proposal)),
    )
    const byId = (list: { type: string; citations: { captureId?: string }[] }[]) => list.map(portable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    expect(byId(proposals)).toEqual(byId(countryBundle.records))
    const [pinned] = await rows<{ sha256: string }>(sql`
      SELECT m.sha256 FROM knowledge_manifestation_revisions m JOIN knowledge_revisions v ON v.revision_id = m.revision_id
      WHERE v.change_request_id = ${draftId}::uuid ORDER BY v.created_at DESC LIMIT 1`)
    expect(pinned?.sha256).toBe(PDF_SHA)
  })

  it('is approved only after a person other than the importer checked the imported page against its source', async () => {
    await submit(draftId)
    const view = await store.readChangeRequest(draftId)
    const unchecked = view!.revisions.flatMap((revision) =>
      revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const })),
    )
    await expect(
      store.platformTransaction(async (tx) => {
        await store.insertReviewDecisions(tx, draftId, { by: prodExpert.userId, decisionSource: 'app' }, unchecked)
        await store.insertApproval(tx, { changeRequestId: draftId, approver: prodExpert.userId, role: 'domain_expert', decisionSource: 'app' })
      }),
    ).rejects.toThrow(/operator-supplied capture/)
    // Positive control: with the source checked, the same person approves.
    await reviewAndPublish(draftId, prodExpert)
    expect(await rows(sql`SELECT id FROM knowledge_records WHERE country_id = 'XA' AND head_revision_id IS NOT NULL`)).toHaveLength(4)
  })
})
