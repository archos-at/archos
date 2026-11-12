/**
 * @vitest-environment node
 *
 * A dispatch that fails LATE, against a REAL Postgres: the real `dispatchIngest`
 * and the real repository, with only the backend's HTTP answer scripted, in the
 * order of the interleaving.
 *
 * Dispatch A asks the backend to read a document and the request hangs. While
 * it hangs, a second dispatch B of the same row gets its job and the row is
 * `pending` under it (or new bytes replace the old ones). Then A gives up and
 * records its failure. That failure is about a read nobody is waiting for any
 * more: it must not land on the row B owns. A row written `failed` there keeps
 * B's job id, and neither the settle push nor a sweep selects it
 * (`listSettleableDocumentsForIngestJobs`, `listStalePendingDocuments`), so it
 * stays `failed` for good although B read the file.
 *
 * And the two cases the guard must leave alone: a failed dispatch with nothing
 * newer still fails the row, with or without an earlier job on it.
 *
 * The same holds for a dispatch that SUCCEEDS late: the job the backend gave
 * for old bytes does not replace the job of the new ones.
 *
 * The second half is the stamp window of local work: who may fail or settle a
 * row that is `processing` and names no job yet. The sweep and a dead job's own
 * run cannot (they go by the name the row carries), a running job of the same
 * bytes may (the new round names that very job next), a job for old bytes
 * cannot, and one case is left open and says so.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/documents/dispatch-failure-race.integration.spec.ts
 *
 * `bash scripts/rls-test-db.sh --only <this file>` builds that database and runs it.
 */

import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://object-store.internal/presigned'),
}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: vi.fn().mockReturnValue('http://backend:8000') }))
vi.mock('./shelf-live', () => ({ publishShelfChanged: vi.fn() }))
vi.mock('@/lib/analytics/ingest-events', () => ({ announceIngestStarted: vi.fn() }))

const url = process.env.TEST_DATABASE_URL
const STAMP = Date.now()
const ORG = `org_dispatch_race_${STAMP}`
const USER = 'user_dispatch_race'
const KEY = 'k/dispatch-race/bericht.pdf'
const NEW_KEY = 'k/dispatch-race/bericht-v2.pdf'
const DISPATCH_FAILED = 'Ingestion could not be started'

/** One scripted answer of the backend to `POST /v1/ingest`. */
type BackendAnswer = () => Promise<Response>

const accepted = (jobId: string): BackendAnswer => async () =>
  new Response(JSON.stringify({ job_id: jobId }), { status: 202, headers: { 'content-type': 'application/json' } })
const refused: BackendAnswer = async () => new Response('unavailable', { status: 503 })
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })

/** A request that hangs until the test lets it time out, or lets the backend take it after all. */
function hanging(): { answer: BackendAnswer; timeOut: () => void; accept: (jobId: string) => void } {
  let resolve: (response: Response | PromiseLike<Response>) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const pending = new Promise<Response>((succeed, fail) => {
    resolve = succeed
    reject = fail
  })
  return { answer: () => pending, timeOut: () => reject(timeout()), accept: (jobId) => resolve(accepted(jobId)()) }
}

describe.skipIf(!url)('a dispatch that fails late, against Postgres', () => {
  let db: ReturnType<typeof import('@/lib/db').getDb>
  let context: typeof import('@/lib/db/tenant-context')
  let schema: typeof import('@/lib/db/schema')
  let repository: typeof import('./repository')
  let dispatchIngest: typeof import('./ingest-dispatch').dispatchIngest
  let queue: typeof import('@/lib/jobs-queue/repository')
  let n = 0

  const inTenant = <T>(run: () => Promise<T>): Promise<T> => context.withTenant({ organizationId: ORG, userId: USER }, run)

  async function insert(fields: { status: string; ingestJobId?: string; bffJobId?: string }): Promise<string> {
    n += 1
    const named = { ingestJobId: fields.ingestJobId, bffJobId: fields.bffJobId }
    const metadata = fields.ingestJobId || fields.bffJobId ? JSON.stringify(named) : null
    const rows = await inTenant(() =>
      db.execute<{ id: string }>(sql`
        INSERT INTO documents (organization_id, created_by, filename, storage_key, collection_name, status, scope, metadata)
        VALUES (${ORG}, ${USER}, ${`bericht-${n}.pdf`}, ${KEY}, ${`archiv_${ORG}`}, ${fields.status},
                'office_shelf', ${metadata}::jsonb)
        RETURNING id
      `),
    )
    return String(Array.from(rows)[0].id)
  }

  const rowOf = async (id: string) => {
    const [row] = await inTenant(() =>
      db
        .select({
          status: schema.documents.status,
          errorMessage: schema.documents.errorMessage,
          storageKey: schema.documents.storageKey,
          ingestJobId: sql<string | null>`${schema.documents.metadata} ->> 'ingestJobId'`,
          bffJobId: sql<string | null>`${schema.documents.metadata} ->> 'bffJobId'`,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, id)),
    )
    return row
  }

  /** New bytes on the row, as a re-upload writes them (`replaceDocumentWithinQuota`): a new key, back to `uploaded`. */
  const replaceBytes = (id: string) =>
    inTenant(() =>
      db
        .update(schema.documents)
        .set({ storageKey: NEW_KEY, status: 'uploaded', errorMessage: null, updatedAt: new Date() })
        .where(eq(schema.documents.id, id)),
    )

  /** The backend answers each request in the order the answers are given. */
  function backendAnswers(...answers: BackendAnswer[]) {
    const fetchSpy = vi.fn(async () => {
      const next = answers.shift()
      if (!next) throw new Error('the backend was asked more often than the interleaving says')
      return next()
    })
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  const dispatch = (id: string, storageKey = KEY) => dispatchIngest(id, `archiv_${ORG}`, storageKey, ORG)

  /** Dispatch A is started and has sent its first request, which hangs. */
  async function startHangingDispatch(id: string, ...later: BackendAnswer[]) {
    const first = hanging()
    const fetchSpy = backendAnswers(first.answer, ...later)
    const outcome = dispatch(id)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    return { outcome, timeOut: first.timeOut, accept: first.accept }
  }

  /** A `bff_job_queue` job for the row's bytes, in the state the interleaving needs. */
  async function seedJob(documentId: string, storageKey: string, status: 'claimed' | 'dead'): Promise<string> {
    const jobId = await inTenant(() =>
      queue.insertJob({ kind: 'office_rendition', organizationId: ORG, priority: 1, payload: { documentId, storageKey } }),
    )
    await setJobStatus(jobId, status)
    return jobId
  }

  const setJobStatus = (jobId: string, status: 'claimed' | 'dead') =>
    context.withPlatformAccess('test seed: put the job in its state', () =>
      db.execute(sql`
        UPDATE bff_job_queue
        SET status = ${status}, dead_at = ${status === 'dead' ? sql`now()` : null},
            claimed_by = ${status === 'claimed' ? 'w-0' : null}, heartbeat_at = ${status === 'claimed' ? sql`now()` : null}
        WHERE job_id = ${jobId}::uuid
      `),
    )

  /** The job a new round of local work names: the open one for these bytes, as `queueDocumentWork` asks. */
  const openJobFor = (documentId: string, storageKey: string) =>
    inTenant(() => queue.findOpenJobId({ kind: 'office_rendition', organizationId: ORG, matching: { documentId, storageKey } }))

  const nameJob = (id: string, jobId: string) =>
    inTenant(() => db.execute(sql`
      UPDATE documents SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('bffJobId', ${jobId}::text),
             updated_at = now() - interval '20 minutes'
      WHERE id = ${id}::uuid
    `))

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    context = await import('@/lib/db/tenant-context')
    db = (await import('@/lib/db')).getDb()
    schema = await import('@/lib/db/schema')
    repository = await import('./repository')
    dispatchIngest = (await import('./ingest-dispatch')).dispatchIngest
    queue = await import('@/lib/jobs-queue/repository')
    await context.withPlatformAccess('test seed: organization', () =>
      db.execute(
        sql`insert into organizations (workos_organization_id, display_name) values (${ORG}, ${ORG}) on conflict do nothing`,
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not fail a row a second dispatch has put in flight, and that read still settles', async () => {
    const id = await insert({ status: 'uploaded' })

    // A: asks, and hangs. B: asks while A hangs, and gets its job.
    const a = await startHangingDispatch(id, accepted('job-b'), refused)
    await expect(dispatch(id)).resolves.toEqual({ jobId: 'job-b', status: 'pending' })
    expect(await rowOf(id)).toMatchObject({ status: 'pending', ingestJobId: 'job-b' })

    // A: times out, asks once more, is refused, and records its failure.
    a.timeOut()
    await expect(a.outcome).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(await rowOf(id)).toMatchObject({ status: 'pending', ingestJobId: 'job-b', errorMessage: null })

    // B ends: the settle push finds the row by its job, and the outcome lands.
    const settleable = await repository.listSettleableDocumentsForIngestJobs(['job-b'])
    expect(settleable.map((row) => row.id)).toEqual([id])
    await expect(
      repository.setDocumentReconciledStatus(id, ORG, { status: 'completed', errorMessage: null }, { status: 'pending', jobId: 'job-b' }),
    ).resolves.toBe(true)
    expect(await rowOf(id)).toMatchObject({ status: 'completed' })
  })

  it('does not fail a row whose second read has already finished', async () => {
    const id = await insert({ status: 'uploaded' })

    const a = await startHangingDispatch(id, accepted('job-b'), refused)
    await dispatch(id)
    await repository.setDocumentReconciledStatus(id, ORG, { status: 'completed', errorMessage: null }, { status: 'pending', jobId: 'job-b' })

    a.timeOut()
    await expect(a.outcome).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(await rowOf(id)).toMatchObject({ status: 'completed', ingestJobId: 'job-b' })
  })

  it('does not fail new bytes for a read of the old ones', async () => {
    const id = await insert({ status: 'uploaded' })

    // A: asks for the old bytes, and hangs. A re-upload replaces them before A gives up.
    const a = await startHangingDispatch(id, refused, accepted('job-new'))
    await replaceBytes(id)
    a.timeOut()
    await expect(a.outcome).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(await rowOf(id)).toMatchObject({ status: 'uploaded', storageKey: NEW_KEY, errorMessage: null })

    // The re-upload's own dispatch is the one the row answers to.
    await expect(dispatch(id, NEW_KEY)).resolves.toEqual({ jobId: 'job-new', status: 'pending' })
    expect(await rowOf(id)).toMatchObject({ status: 'pending', ingestJobId: 'job-new' })
  })

  it('still fails a row whose only dispatch could not start', async () => {
    const id = await insert({ status: 'uploaded' })

    backendAnswers(refused)
    await expect(dispatch(id)).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(await rowOf(id)).toMatchObject({ status: 'failed', errorMessage: DISPATCH_FAILED })
  })

  it('still fails a row after two timeouts when nothing newer took it', async () => {
    const id = await insert({ status: 'uploaded' })

    const a = await startHangingDispatch(id, async () => {
      throw timeout()
    })
    a.timeOut()
    await expect(a.outcome).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(await rowOf(id)).toMatchObject({ status: 'failed', errorMessage: DISPATCH_FAILED })
  })

  it('still fails a read-again of a finished row that could not start: the attempt is what failed', async () => {
    const id = await insert({ status: 'completed', ingestJobId: 'job-earlier' })

    backendAnswers(refused)
    await expect(dispatch(id)).resolves.toEqual({ jobId: null, status: 'failed' })

    expect(await rowOf(id)).toMatchObject({ status: 'failed', ingestJobId: 'job-earlier', errorMessage: DISPATCH_FAILED })
  })

  it('does not let the late success of a read of old bytes take the row from the read of the new ones', async () => {
    const id = await insert({ status: 'uploaded' })

    // A: asks for the old bytes, and hangs. New bytes arrive and their dispatch B gets its job.
    const a = await startHangingDispatch(id, accepted('job-new'))
    await replaceBytes(id)
    await expect(dispatch(id, NEW_KEY)).resolves.toEqual({ jobId: 'job-new', status: 'pending' })

    // A: the backend takes the old bytes after all.
    a.accept('job-old')
    await a.outcome

    expect(await rowOf(id)).toMatchObject({ status: 'pending', ingestJobId: 'job-new', storageKey: NEW_KEY })
  })

  describe('the stamp window: `processing`, and the new job not named yet', () => {
    it('hides the row from the dead job it named before, and from a sweep that read it then', async () => {
      const id = await insert({ status: 'processing' })
      const dead = await seedJob(id, KEY, 'dead')
      await nameJob(id, dead)
      const found = async (stranded: Date | { deadJobId: string }) =>
        (await repository.listStuckProcessingDocuments(stranded, 500)).some((row) => row.id === id)
      expect(await found({ deadJobId: dead })).toBe(true)
      expect(await found(new Date(Date.now() - 15 * 60_000))).toBe(true)

      // A new round starts: the name is dropped, and no job is named yet.
      await repository.markDocumentProcessing(id, ORG)

      expect(await found({ deadJobId: dead })).toBe(false)
      expect(await found(new Date(Date.now() - 15 * 60_000))).toBe(false)
      await expect(repository.markDocumentIngestFailed(id, ORG, DISPATCH_FAILED, { backgroundJobId: dead })).resolves.toBe(false)
      expect(await rowOf(id)).toMatchObject({ status: 'processing', bffJobId: null })
    })

    it('lets a running job of the same bytes fail the row: it is the job the new round names', async () => {
      const id = await insert({ status: 'processing' })
      const running = await seedJob(id, KEY, 'claimed')
      await nameJob(id, running)

      await repository.markDocumentProcessing(id, ORG)
      expect(await openJobFor(id, KEY)).toBe(running)

      const own = { storageKey: KEY, backgroundJobId: running, unnamedCounts: true }
      await expect(repository.markDocumentIngestFailed(id, ORG, 'IFC extraction failed', own)).resolves.toBe(true)
    })

    it('does not let a job for the old bytes fail or settle the row of the new ones', async () => {
      const id = await insert({ status: 'processing' })
      const earlier = await seedJob(id, KEY, 'claimed')
      await nameJob(id, earlier)

      // The earlier job has converted the old bytes and asks the backend, which hangs.
      const a = await startHangingDispatch(id)
      // New bytes: a new round starts, and its job is not named yet.
      await replaceBytes(id)
      await repository.markDocumentProcessing(id, ORG)
      expect(await openJobFor(id, NEW_KEY)).toBeNull()

      const own = { storageKey: KEY, backgroundJobId: earlier, unnamedCounts: true }
      await expect(repository.markDocumentIngestFailed(id, ORG, 'IFC extraction failed', own)).resolves.toBe(false)
      // The backend takes the old bytes after all, inside the window.
      a.accept('job-old')
      await a.outcome

      expect(await rowOf(id)).toMatchObject({ status: 'processing', storageKey: NEW_KEY, ingestJobId: null })
    })

    /**
     * The one interleaving left open, written down as what happens. A job on its
     * last attempt writes its failure after a new round dropped its name, and
     * the queue buries it before that round looks for an open job. Both must
     * fall between two consecutive statements of `queueDocumentWork`. The row
     * reads `failed` with the true reason for these bytes and offers the retry
     * again; the job the round then queues finds a row that is not `processing`
     * and leaves. Nothing is shown as read that was not. Closing it means one
     * transaction over the enqueue and the stamp, which the queue does not offer.
     */
    it('leaves a job buried inside the window as a failed row that can be retried', async () => {
      const id = await insert({ status: 'processing' })
      const dying = await seedJob(id, KEY, 'claimed')
      await nameJob(id, dying)

      await repository.markDocumentProcessing(id, ORG)
      const own = { storageKey: KEY, backgroundJobId: dying, unnamedCounts: true }
      await expect(repository.markDocumentIngestFailed(id, ORG, 'IFC extraction failed', own)).resolves.toBe(true)
      await setJobStatus(dying, 'dead')
      expect(await openJobFor(id, KEY)).toBeNull()

      const next = await seedJob(id, KEY, 'claimed')
      await repository.setDocumentBackgroundJob(id, ORG, next)
      expect(await rowOf(id)).toMatchObject({ status: 'failed', errorMessage: 'IFC extraction failed', bffJobId: null })
    })
  })
})
