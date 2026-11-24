/**
 * @vitest-environment node
 */

import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { projectMemory } from '@/lib/db/schema/project-memory'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import {
  NEAR_DUP_JACCARD_THRESHOLD,
  contentTokens,
  jaccardSimilarity,
  polaritySignature,
} from '@/lib/knowledge/consolidation'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/knowledge/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/embeddings')>()
  return { ...actual, embedNote: vi.fn(async () => null), embedNotes: vi.fn(async () => null) }
})

import { embedNote, embedNotes } from '@/lib/knowledge/embeddings'

const url = process.env.TEST_DATABASE_URL

const ORG = `org_memory_${Date.now()}`
const USER = `user_${ORG}`

const FINGERPRINT = 'integration-test-embedder'
const DIMENSIONS = 8

const TOPIC_AXES: ReadonlyArray<readonly [RegExp, number]> = [
  [/flachdach/i, 0],
  [/smoke extraction/i, 1],
  [/pressuris/i, 2],
]

function hashOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

function topicVector(text: string): number[] {
  const axis = TOPIC_AXES.find(([pattern]) => pattern.test(text))?.[1] ?? DIMENSIONS - 1
  const vector = new Array<number>(DIMENSIONS).fill(0)
  vector[axis] = 1
  vector[DIMENSIONS - 2] = 0.05 + (hashOf(text) % 100) / 2000
  return vector
}

function useEmbedder(): void {
  vi.mocked(embedNote).mockImplementation(async (text) => ({
    vector: topicVector(text),
    fingerprint: FINGERPRINT,
  }))
}

describe('the memory consolidation suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(
      url,
      'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set, so the ' +
        'memory consolidation suite skipped and nothing verified "one fact, one live row". ' +
        'Check `task db:test:rls`.'
    ).toBeTruthy()
  })
})

describe.skipIf(!url)('memory consolidation against live Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let withTenant: typeof import('@/lib/db/tenant-context').withTenant
  let withPlatformAccess: typeof import('@/lib/db/tenant-context').withPlatformAccess
  let createProjectMemoryItem: typeof import('./memory-service').createProjectMemoryItem
  let buildProjectMemoryDigest: typeof import('./memory-service').buildProjectMemoryDigest

  const inTenant = <T>(run: () => Promise<T>): Promise<T> =>
    withTenant({ organizationId: ORG, userId: USER }, run)

  async function seedProject(name: string): Promise<string> {
    const rows = await inTenant(() =>
      db.execute(
        sql`insert into projects (organization_id, name, created_by, collection_name)
            values (${ORG}, ${name}, ${USER}, ${`coll_${name}`})
            returning id`
      )
    )
    return String([...rows][0].id)
  }

  const rowsOf = (projectId: string): Promise<ProjectMemoryItem[]> =>
    inTenant(() => db.select().from(projectMemory).where(eq(projectMemory.projectId, projectId)))

  const live = (rows: ProjectMemoryItem[]): ProjectMemoryItem[] =>
    rows.filter((row) => row.status === 'active')

  const remember = (
    projectId: string,
    kind: ProjectMemoryItem['kind'],
    content: string,
    options: Parameters<typeof createProjectMemoryItem>[1] = {}
  ): Promise<ProjectMemoryItem> =>
    inTenant(() =>
      createProjectMemoryItem(
        { scope: 'project', projectId, organizationId: ORG, kind, content },
        options
      )
    )

  beforeAll(async () => {
    vi.stubEnv('APP_DATABASE_URL', url)
    const context = await import('@/lib/db/tenant-context')
    withTenant = context.withTenant
    withPlatformAccess = context.withPlatformAccess
    db = (await import('@/lib/db')).getDb()
    createProjectMemoryItem = (await import('./memory-service')).createProjectMemoryItem
    buildProjectMemoryDigest = (await import('./memory-service')).buildProjectMemoryDigest

    await withPlatformAccess('test seed: create the organization', () =>
      db.execute(
        sql`insert into organizations (workos_organization_id, display_name)
            values (${ORG}, ${ORG}) on conflict do nothing`
      )
    )
  })

  afterEach(() => {
    vi.mocked(embedNote).mockReset()
    vi.mocked(embedNote).mockResolvedValue(null)
  })

  afterAll(async () => {
    if (!db) return
    await withPlatformAccess('test teardown', async () => {
      await db.execute(sql`delete from project_memory where organization_id = ${ORG}`)
      await db.execute(sql`delete from projects where organization_id = ${ORG}`)
      await db.execute(sql`delete from organizations where workos_organization_id = ${ORG}`)
    })
    const { closeDb } = await import('@/lib/db')
    await closeDb()
  })

  it('writes the same fact twice into one live row', async () => {
    const projectId = await seedProject('exact')
    const content = 'Die Gebäudeklasse ist GK 4'

    const first = await remember(projectId, 'derived_fact', content)
    const second = await remember(projectId, 'derived_fact', content)

    const rows = await rowsOf(projectId)
    expect(rows).toHaveLength(1)
    expect(live(rows).map((row) => row.id)).toEqual([first.id])
    expect(second.id).toBe(first.id)
  })

  it('merges a paraphrase the embedder recognises into the existing row, across kinds', async () => {
    useEmbedder()
    const projectId = await seedProject('paraphrase')
    const stated = 'Der Bauherr wünscht ein Flachdach'
    const restated = 'Flachdach ist gewünscht'

    expect(jaccardSimilarity(contentTokens(stated), contentTokens(restated))).toBeLessThan(
      NEAR_DUP_JACCARD_THRESHOLD
    )
    expect(polaritySignature(stated)).toBe(polaritySignature(restated))

    const first = await remember(projectId, 'constraint', stated)
    const second = await remember(projectId, 'derived_fact', restated)

    const rows = await rowsOf(projectId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(first.id)
    expect(second.id).toBe(first.id)
    expect(rows[0].embeddingModel).toBe(FINGERPRINT)
  })

  it('supersedes rather than merges when the paraphrase says the opposite', async () => {
    useEmbedder()
    const projectId = await seedProject('correction')
    const claim = 'Der Bauherr wünscht ein Flachdach'
    const correction = 'Der Bauherr wünscht kein Flachdach'
    expect(polaritySignature(claim)).not.toBe(polaritySignature(correction))

    const stale = await remember(projectId, 'constraint', claim)
    const retired: string[] = []
    const current = await remember(projectId, 'constraint', correction, {
      onSuperseded: (id) => retired.push(id),
    })

    const rows = await rowsOf(projectId)
    expect(rows).toHaveLength(2)
    expect(live(rows).map((row) => row.id)).toEqual([current.id])
    expect(current.supersedesId).toBe(stale.id)
    expect(rows.find((row) => row.id === stale.id)?.status).toBe('superseded')
    expect(retired).toEqual([stale.id])
  })

  it('retires the named target even when the finding merges into a paraphrase', async () => {
    useEmbedder()
    const projectId = await seedProject('named')
    const existing = await remember(
      projectId,
      'derived_fact',
      'Natural smoke extraction was approved for the stairwell'
    )
    const stale = await remember(
      projectId,
      'constraint',
      'The stairwell must be pressurised (Druckbelueftung)'
    )
    expect(live(await rowsOf(projectId))).toHaveLength(2)

    const retired: string[] = []
    const merged = await remember(
      projectId,
      'derived_fact',
      'Natural smoke extraction was approved for the stairwell instead',
      {
        supersedesContent: 'The stairwell must be pressurised (Druckbelueftung)',
        onSuperseded: (id) => retired.push(id),
      }
    )

    const rows = await rowsOf(projectId)
    expect(rows).toHaveLength(2)
    expect(merged.id).toBe(existing.id)
    expect(live(rows).map((row) => row.id)).toEqual([existing.id])
    expect(rows.find((row) => row.id === stale.id)?.status).toBe('superseded')
    expect(retired).toEqual([stale.id])
  })

  describe('the digest waits for the query embed only when a vector can change it', () => {
    const embedThatHangs = () => vi.mocked(embedNote).mockImplementation(() => new Promise(() => {}))
    const digestFor = (projectId: string, timing: import('./memory-recall').DigestTiming = {}) =>
      inTenant(() => buildProjectMemoryDigest(projectId, ORG, { query: 'Wie hoch ist die Attika?', timing }))

    afterEach(() => {
      vi.mocked(embedNotes).mockReset()
      vi.mocked(embedNotes).mockResolvedValue(null)
    })

    it('answers an empty scope without waiting, and the same null as before', async () => {
      const projectId = await seedProject('dense_empty')
      embedThatHangs()
      const timing = {}
      expect(await digestFor(projectId, timing)).toBeNull()
      expect(timing).toMatchObject({ dense: 'skipped' })
      expect(vi.mocked(embedNote).mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(embedNotes).not.toHaveBeenCalled()
    })

    it('ranks vector-less notes exactly as with no embedder at all, and still backfills them', async () => {
      const projectId = await seedProject('dense_none')
      await remember(projectId, 'constraint', 'Die Attika ist mit 1,10 m ausgeführt')
      await remember(projectId, 'decision', 'Das Flachdach wird extensiv begrünt')
      await remember(projectId, 'derived_fact', 'Die Gebäudeklasse ist GK 4')

      const withoutEmbedder = await digestFor(projectId)
      expect(withoutEmbedder).toContain('Attika')
      vi.mocked(embedNotes).mockClear()

      embedThatHangs()
      const timing = {}
      expect(await digestFor(projectId, timing)).toBe(withoutEmbedder)
      expect(timing).toMatchObject({ dense: 'skipped' })
      expect(vi.mocked(embedNotes).mock.calls[0][0]).toHaveLength(3)
    })

    it('waits for the vector when a note carries one, and ranks by it', async () => {
      const projectId = await seedProject('dense_ranked')
      useEmbedder()
      await remember(projectId, 'constraint', 'Smoke extraction is natural in the stairwell')
      await remember(projectId, 'decision', 'The Flachdach is extensively planted')
      vi.mocked(embedNote).mockImplementation(async (text) => ({
        vector: topicVector(/Attika/.test(text) ? 'smoke extraction' : text),
        fingerprint: FINGERPRINT,
      }))
      const timing = {}
      const digest = await digestFor(projectId, timing)
      expect(timing).toMatchObject({ dense: 'ranked' })
      const lines = (digest ?? '').split('\n').filter((line) => line.startsWith('- ['))
      expect(lines[0]).toContain('Smoke extraction')
    })
  })
})
