/**
 * The carry's last steps (ADR-0181), after a country is published to stable (`./carry.ts`):
 *
 * - Wait, bounded, until the base corpus holds every carried text ingested with the country's mark. Read from the
 *   corpus's own state, since an index run's `queued` says only that the corpus accepted the file. A failed index
 *   run, or the deadline, fails the carry.
 * - Give each text the document class and display title it carries on the source (the manifest's `texts`).
 * - Once every bundle is settled: delete each base-corpus file whose bytes are a released text's and that no record
 *   names (the legacy copies uploaded before the records, as dev did on 2026-11-12). Every other file stays.
 *   Idempotent: a second run finds nothing to delete.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { NotFoundError } from '@/lib/api/errors'
import { deleteKnowledgeBaseDocument, getKnowledgeBaseStatus, updateKnowledgeBaseDisplayTitle, updateKnowledgeBaseDocClass } from '@/lib/knowledge/service'
import type { CarriedBundle } from './carry-manifest'
import type { ReleaseBundle } from './release-wire'
import { platformTransaction } from './store'
import { otherRecordNaming } from './text-store'

export type CarryLog = (step: string, facts?: Record<string, unknown>) => void

export const DEFAULT_POLL_MS = 15_000

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function failedRuns(changeRequestId: string): Promise<{ corpus_file: string; failure: string | null }[]> {
  return platformTransaction((tx) =>
    tx.execute<{ corpus_file: string; failure: string | null }>(sql`
      SELECT corpus_file, failure FROM knowledge_index_runs WHERE change_request_id = ${changeRequestId}::uuid AND state = 'failed'`),
  )
}

/** Wait for the country's texts, then label them as the source does. */
export async function settleTexts(
  entry: CarriedBundle,
  changeRequestId: string,
  ctx: { log: CarryLog; waitMs: number; pollMs?: number },
): Promise<void> {
  const names = Object.keys(entry.texts)
  if (names.length === 0) return
  const deadline = Date.now() + ctx.waitMs
  for (;;) {
    const failed = await failedRuns(changeRequestId)
    if (failed.length > 0) throw new Error(`${failed.length} index run(s) of ${changeRequestId} failed: ${JSON.stringify(failed.slice(0, 5))}`)
    const files = new Map((await getKnowledgeBaseStatus()).files.map((file) => [file.fileName, file]))
    const waiting = names.filter((name) => files.get(name)?.state !== 'ingested' || files.get(name)?.countryId !== entry.countryId)
    if (waiting.length === 0) break
    if (Date.now() > deadline) {
      throw new Error(`${waiting.length} of ${names.length} ${entry.countryId} text(s) not ingested with the mark ${entry.countryId} in time: ${waiting.slice(0, 10).join(', ')}`)
    }
    ctx.log('waiting for the corpus', { countryId: entry.countryId, waiting: waiting.length, of: names.length })
    await sleep(ctx.pollMs ?? DEFAULT_POLL_MS)
  }
  ctx.log('texts ingested', { countryId: entry.countryId, texts: names.length })
  const files = new Map((await getKnowledgeBaseStatus()).files.map((file) => [file.fileName, file]))
  let labelled = 0
  for (const [name, label] of Object.entries(entry.texts)) {
    const held = files.get(name)
    if (label.docClass && held?.docClass !== label.docClass) {
      await updateKnowledgeBaseDocClass(name, label.docClass)
      labelled += 1
    }
    if (label.displayTitle && held?.displayTitle !== label.displayTitle) {
      await updateKnowledgeBaseDisplayTitle(name, label.displayTitle)
      labelled += 1
    }
  }
  ctx.log('texts labelled', { countryId: entry.countryId, changed: labelled })
}

/** Delete the legacy copies of released texts: same bytes, another name, named by no record. */
export async function retireLegacyCopies(bundles: readonly ReleaseBundle[], ctx: { log: CarryLog }): Promise<string[]> {
  const released = new Set(bundles.flatMap((bundle) => bundle.texts.map((text) => text.sha256)))
  const releasedNames = new Set(bundles.flatMap((bundle) => bundle.texts.map((text) => text.fileName)))
  const copies = (await getKnowledgeBaseStatus()).files.filter(
    (file) => file.state !== 'removed' && !releasedNames.has(file.fileName) && file.currentSha256 !== null && released.has(file.currentSha256),
  )
  const deleted: string[] = []
  for (const file of copies) {
    const naming = await platformTransaction((tx) => otherRecordNaming(tx, file.fileName, null))
    if (naming) {
      ctx.log('legacy copy kept', { fileName: file.fileName, namedBy: naming })
      continue
    }
    try {
      await deleteKnowledgeBaseDocument(file.fileName)
    } catch (error) {
      // Gone since the status was read: nothing left to delete.
      if (!(error instanceof NotFoundError)) throw error
    }
    deleted.push(file.fileName)
    ctx.log('legacy copy deleted', { fileName: file.fileName, sha256: file.currentSha256 })
  }
  ctx.log('legacy copies retired', { deleted: deleted.length, considered: copies.length })
  return deleted
}
