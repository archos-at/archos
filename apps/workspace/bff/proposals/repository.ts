import 'server-only'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { proposedChanges, type ProposedChangeRow, type ProposerKind } from '@/lib/db/schema/proposed-changes'
import { withTenant } from '@/lib/db/tenant-context'
import type { ProposalScope, ProposedChangeKind, ProposedChangeResult, ProposedChangeStatus } from './types'

export type { ProposedChangeRow }

export interface NewProposedChange {
  organizationId: string
  projectId: string | null
  scope: ProposalScope
  kind: ProposedChangeKind
  payload: unknown
  proposedByKind: ProposerKind
  onBehalfOf: string
  originConversationId: string | null
  originMessageId: string | null
  originCardIndex?: number | null
  originTraceId?: string | null
}

export interface InsertedProposedChange {
  row: ProposedChangeRow
  created: boolean
}

export interface OperationCall {
  operation: string
  input: unknown
}

const openOperationCall = (organizationId: string, conversationId: string, onBehalfOf: string, call: OperationCall) =>
  and(
    eq(proposedChanges.organizationId, organizationId),
    eq(proposedChanges.originConversationId, conversationId),
    eq(proposedChanges.onBehalfOf, onBehalfOf),
    eq(proposedChanges.kind, 'operation'),
    eq(proposedChanges.status, 'proposed'),
    sql`${proposedChanges.payload}->>'operation' = ${call.operation}`,
    sql`${proposedChanges.payload}->'input' = ${JSON.stringify(call.input ?? {})}::jsonb`
  )

export async function findOpenOperationProposal(
  organizationId: string,
  conversationId: string,
  onBehalfOf: string,
  call: OperationCall
): Promise<ProposedChangeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(proposedChanges)
      .where(openOperationCall(organizationId, conversationId, onBehalfOf, call))
      .orderBy(proposedChanges.createdAt)
      .limit(1)
  )
  return row ?? null
}

function dedupedCall(input: NewProposedChange): OperationCall | null {
  if (input.kind !== 'operation' || !input.originConversationId || input.originCardIndex != null) return null
  const payload = input.payload as Partial<OperationCall> | null
  return typeof payload?.operation === 'string' ? { operation: payload.operation, input: payload.input } : null
}

export async function insertProposedChange(input: NewProposedChange): Promise<InsertedProposedChange> {
  const db = getDb()
  const { organizationId, originMessageId, originCardIndex } = input
  return withTenant({ organizationId }, async () => {
    const values = { ...input, originCardIndex: originCardIndex ?? null, status: 'proposed' as const }
    const call = dedupedCall(input)
    if (call && input.originConversationId) {
      const [made] = await db.insert(proposedChanges).values(values).onConflictDoNothing().returning()
      if (made) return { row: made, created: true }
      const [open] = await db
        .select()
        .from(proposedChanges)
        .where(openOperationCall(organizationId, input.originConversationId, input.onBehalfOf, call))
        .orderBy(proposedChanges.createdAt)
        .limit(1)
      if (!open) throw new Error('A proposal for this call conflicted and could not be read back')
      return { row: open, created: false }
    }
    if (originCardIndex === null || originCardIndex === undefined || !originMessageId) {
      const [row] = await db.insert(proposedChanges).values(values).returning()
      return { row, created: true }
    }
    const [inserted] = await db
      .insert(proposedChanges)
      .values(values)
      .onConflictDoNothing({
        target: [proposedChanges.organizationId, proposedChanges.originMessageId, proposedChanges.originCardIndex],
        where: sql`${proposedChanges.originCardIndex} IS NOT NULL`,
      })
      .returning()
    if (inserted) return { row: inserted, created: true }
    const [existing] = await db
      .select()
      .from(proposedChanges)
      .where(
        and(
          eq(proposedChanges.organizationId, organizationId),
          eq(proposedChanges.originMessageId, originMessageId),
          eq(proposedChanges.originCardIndex, originCardIndex)
        )
      )
      .limit(1)
    if (!existing) throw new Error('A proposal for this card conflicted and could not be read back')
    return { row: existing, created: false }
  })
}

export async function findProposedChange(organizationId: string, id: string): Promise<ProposedChangeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(proposedChanges)
      .where(and(eq(proposedChanges.organizationId, organizationId), eq(proposedChanges.id, id)))
      .limit(1)
  )
  return row ?? null
}

const undecided = (organizationId: string, id: string, staleBefore: Date) =>
  and(
    eq(proposedChanges.organizationId, organizationId),
    eq(proposedChanges.id, id),
    eq(proposedChanges.status, 'proposed'),
    or(isNull(proposedChanges.applyingSince), lt(proposedChanges.applyingSince, staleBefore))
  )

const heldClaim = (organizationId: string, id: string, by: string, since: Date) =>
  and(
    eq(proposedChanges.organizationId, organizationId),
    eq(proposedChanges.id, id),
    eq(proposedChanges.status, 'proposed'),
    eq(proposedChanges.applyingBy, by),
    eq(proposedChanges.applyingSince, since)
  )

export async function claimProposedChange(
  organizationId: string,
  id: string,
  userId: string,
  staleBefore: Date
): Promise<ProposedChangeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(proposedChanges)
      .set({ applyingBy: userId, applyingSince: new Date() })
      .where(undecided(organizationId, id, staleBefore))
      .returning()
  )
  return row ?? null
}

export async function settleProposedChange(
  organizationId: string,
  claim: Pick<ProposedChangeRow, 'id' | 'applyingBy' | 'applyingSince'>,
  outcome: { status: Extract<ProposedChangeStatus, 'applied' | 'partially_applied' | 'failed'>; results: ProposedChangeResult[] }
): Promise<ProposedChangeRow | null> {
  const { applyingBy: by, applyingSince: since } = claim
  if (!by || !since) return null
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(proposedChanges)
      .set({
        status: outcome.status,
        results: outcome.results,
        decidedBy: by,
        decidedAt: new Date(),
        applyingBy: null,
        applyingSince: null,
      })
      .where(heldClaim(organizationId, claim.id, by, since))
      .returning()
  )
  return row ?? null
}

export async function releaseProposedChange(
  organizationId: string,
  claim: Pick<ProposedChangeRow, 'id' | 'applyingBy' | 'applyingSince'>
): Promise<void> {
  const { applyingBy: by, applyingSince: since } = claim
  if (!by || !since) return
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(proposedChanges)
      .set({ applyingBy: null, applyingSince: null })
      .where(heldClaim(organizationId, claim.id, by, since))
  )
}

export async function dismissProposedChange(
  organizationId: string,
  id: string,
  userId: string,
  staleBefore: Date
): Promise<ProposedChangeRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(proposedChanges)
      .set({ status: 'dismissed', decidedBy: userId, decidedAt: new Date(), applyingBy: null, applyingSince: null })
      .where(undecided(organizationId, id, staleBefore))
      .returning()
  )
  return row ?? null
}

export type ProposalShelf = { scope: 'project'; projectId: string } | { scope: 'office_shelf' | 'organization' }

const onShelf = (organizationId: string, shelf: ProposalShelf) =>
  and(
    eq(proposedChanges.organizationId, organizationId),
    eq(proposedChanges.scope, shelf.scope),
    shelf.scope === 'project' ? eq(proposedChanges.projectId, shelf.projectId) : isNull(proposedChanges.projectId)
  )

export const MAX_SHELF_PROPOSALS = 500

export async function listShelfProposals(
  organizationId: string,
  shelf: ProposalShelf,
  options: {
    statuses: readonly ProposedChangeStatus[]
    kind?: ProposedChangeKind
    withoutConversation?: boolean
    after?: string
    limit: number
  }
): Promise<ProposedChangeRow[]> {
  const limit = Math.min(Math.max(1, Math.trunc(options.limit)), MAX_SHELF_PROPOSALS)
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(proposedChanges)
      .where(
        and(
          onShelf(organizationId, shelf),
          inArray(proposedChanges.status, [...options.statuses]),
          options.kind ? eq(proposedChanges.kind, options.kind) : undefined,
          options.withoutConversation ? isNull(proposedChanges.originConversationId) : undefined,
          options.after
            ? sql`(${proposedChanges.createdAt}, ${proposedChanges.id}) < (select p.created_at, p.id from proposed_changes p where p.id = ${options.after}::uuid)`
            : undefined
        )
      )
      .orderBy(desc(proposedChanges.createdAt), desc(proposedChanges.id))
      .limit(limit)
  )
}

export const MAX_CONVERSATION_PROPOSALS = 20

export async function listConversationProposals(
  organizationId: string,
  conversationId: string,
  limit: number
): Promise<ProposedChangeRow[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), MAX_CONVERSATION_PROPOSALS)
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .select()
      .from(proposedChanges)
      .where(
        and(
          eq(proposedChanges.organizationId, organizationId),
          eq(proposedChanges.originConversationId, conversationId)
        )
      )
      .orderBy(desc(proposedChanges.createdAt), desc(proposedChanges.id))
      .limit(bounded)
  )
}

export async function deleteUndecidedProposedChange(
  organizationId: string,
  id: string,
  staleBefore: Date
): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db.delete(proposedChanges).where(undecided(organizationId, id, staleBefore)).returning({ id: proposedChanges.id })
  )
  return rows.length > 0
}
