/**
 * Which edition an answer used, in which role and at which pack sequences
 * (design §5.5 "Server-side record", E25, ADR-0173), written when the BFF
 * persists the backend's answer (`persistInternalConversationMessages`).
 *
 * The role, the edition and the sequences come from the knowledge context the
 * BFF resolves itself, never from the provenance a client sent; the backend's
 * cited sources only choose which of those uses the answer rested on: by the
 * id of the record each was read as (`edition_id`, `work_id`), and for a source
 * that states none, by its corpus file. A
 * hotfix notice and a replay read this table. Advisory: a failure here never
 * costs the answer its row.
 */

import 'server-only'
import { getDb } from '@/lib/db'
import { messageEditionUses } from '@/lib/db/schema/knowledge-context'
import { withTenant } from '@/lib/db/tenant-context'
import { turnContextOf } from './turn-snapshot'
import type { KnowledgeContext } from './wire'

/** Most uses one answer records: the context's own bound. */
const MAX_RECORDED = 40

export interface EditionUseRow {
  workId: string
  editionId: string | null
  role: KnowledgeContext['uses'][number]['role']
  qualifier: KnowledgeContext['uses'][number]['qualifier']
  packSeqs: Record<string, number>
}

/** The base-corpus files an answer cited, from the backend's `sources` (`file_name`). Pure. */
export function citedFiles(metadata: Record<string, unknown> | undefined): Set<string> {
  const sources = metadata?.sources
  if (!Array.isArray(sources)) return new Set()
  return new Set(
    sources.flatMap((source) =>
      source && typeof source === 'object' && typeof (source as { file_name?: unknown }).file_name === 'string'
        ? [(source as { file_name: string }).file_name]
        : [],
    ),
  )
}

/** The knowledge records an answer's cited sources were read as (`edition_id`, and `work_id` for law read live). Pure. */
export function citedRecords(metadata: Record<string, unknown> | undefined): CitedRecords {
  const sources = Array.isArray(metadata?.sources) ? metadata.sources : []
  const ids = (key: 'edition_id' | 'work_id', only: (source: Record<string, unknown>) => boolean = () => true) =>
    new Set(
      sources.flatMap((source) =>
        source && typeof source === 'object' && typeof (source as Record<string, unknown>)[key] === 'string' && only(source as Record<string, unknown>)
          ? [(source as Record<string, string>)[key]]
          : [],
      ),
    )
  return { editionIds: ids('edition_id'), liveWorkIds: ids('work_id', (source) => typeof source.edition_id !== 'string') }
}

export interface CitedRecords {
  editionIds: ReadonlySet<string>
  /** Works cited with no edition: law read live at its source. */
  liveWorkIds: ReadonlySet<string>
}

const NO_RECORDS: CitedRecords = { editionIds: new Set(), liveWorkIds: new Set() }

/** The uses of the context an answer rested on, by the records and files its sources name, with the context's pack sequences. Pure. */
export function editionUsesOf(
  context: Pick<KnowledgeContext, 'packs' | 'uses'>,
  files: ReadonlySet<string>,
  records: CitedRecords = NO_RECORDS,
): EditionUseRow[] {
  if (files.size === 0 && records.editionIds.size === 0 && records.liveWorkIds.size === 0) return []
  const packSeqs = Object.fromEntries(context.packs.map((pack) => [pack.packId, pack.seq]))
  return context.uses
    .filter(
      (use) =>
        (use.editionId !== null && records.editionIds.has(use.editionId)) ||
        (use.editionId === null && records.liveWorkIds.has(use.workId)) ||
        use.corpusFiles.some((file) => files.has(file)),
    )
    .slice(0, MAX_RECORDED)
    .map((use) => ({ workId: use.workId, editionId: use.editionId, role: use.role, qualifier: use.qualifier, packSeqs }))
}

interface AnswerInput {
  id: string
  role: string
  metadata?: Record<string, unknown>
}

/**
 * Record the editions each persisted answer used, from the context its turn
 * was answered on (`turn-snapshot.ts`), never one resolved now: a release that
 * landed mid-turn must not be recorded as what the answer read (E42). Nothing
 * outside a project, without citations, or when no snapshot was kept (the flag
 * off, or expired): a missing record is safer than a wrong one.
 */
export async function recordEditionUses(
  organizationId: string,
  projectId: string | null,
  conversationId: string,
  answers: readonly AnswerInput[],
): Promise<number> {
  const cited = answers
    .filter((input) => input.role === 'assistant')
    .map((input) => ({ id: input.id, files: citedFiles(input.metadata), records: citedRecords(input.metadata) }))
  const citesNothing = (answer: (typeof cited)[number]) =>
    answer.files.size === 0 && answer.records.editionIds.size === 0 && answer.records.liveWorkIds.size === 0
  if (!projectId || cited.every(citesNothing)) return 0
  try {
    const context = await turnContextOf(organizationId, conversationId)
    if (!context) return 0
    const rows = cited.flatMap((answer) =>
      editionUsesOf(context, answer.files, answer.records).map((use) => ({ ...use, messageId: answer.id, organizationId, projectId })),
    )
    if (rows.length === 0) return 0
    await withTenant({ organizationId }, () => getDb().insert(messageEditionUses).values(rows).onConflictDoNothing())
    return rows.length
  } catch (error) {
    console.warn('[base-knowledge] could not record the editions an answer used', { organizationId, error })
    return 0
  }
}
