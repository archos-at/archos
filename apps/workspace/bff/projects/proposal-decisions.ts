import 'server-only'
import { z } from 'zod'
import { maskChatText } from '@/lib/upload-screening/service'
import { listRecentMessagesWithCardDecisions } from '@/lib/conversations/repository'
import { buildPatchPreviewRows } from '@/lib/project-profile/patch-preview'
import { ProjectProfilePatchOperationSchema } from '@/lib/project-profile/types'
import { listRecentDecidedProposals, type DecidedProposalRow } from './proposal-decision-rows'
import {
  DIGEST_BLOCK_MAX_CHARS,
  formatBoundedDigest,
  type DigestLineItem,
} from '@/lib/knowledge/digest-format'

export const PROPOSAL_DECISIONS_HEADER = 'PROPOSAL_DECISIONS v1'
const MESSAGE_SCAN_LIMIT = 40
const MAX_DECISIONS = 10
const ROW_LINE_MAX_CHARS = 240

type Decision =
  | 'accepted'
  | 'rejected'
  | 'savedOrg'
  | 'savedProject'
  | 'dismissed'
  | 'partiallyApplied'

const INSTANT = z.string().datetime({ offset: true })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

function verdictOf(decision: string): 'accepted' | 'declined' | null {
  switch (decision as Decision) {
    case 'accepted':
    case 'savedOrg':
    case 'savedProject':
    case 'partiallyApplied':
      return 'accepted'
    case 'rejected':
    case 'dismissed':
      return 'declined'
    default:
      return null
  }
}

function instantOf(value: unknown): string | null {
  const parsed = INSTANT.safeParse(value)
  return parsed.success ? new Date(parsed.data).toISOString() : null
}

function describeCard(card: Record<string, unknown>): { kind: string; content: string } | null {
  const type = asString(card.type)
  if (type === 'project_profile_patch') {
    const title = asString(card.title) ?? 'Update project context'
    const preview = Array.isArray(card.preview) ? card.preview : []
    const changes = preview
      .filter(isRecord)
      .map((item) => {
        const label = asString(item.label)
        const before = asString(item.before)
        const after = asString(item.after)
        if (!label || !after) return null
        return before ? `${label}: ${before} → ${after}` : `${label}: ${after}`
      })
      .filter((change): change is string => change !== null)
      .slice(0, 3)
    return { kind: 'profile', content: changes.length > 0 ? `${title} (${changes.join('; ')})` : title }
  }
  if (type === 'memory_proposal') {
    const content = asString(card.content)
    return content ? { kind: 'note', content } : null
  }
  if (type === 'file_operation_proposal') {
    const title = asString(card.title)
    const operation = asString(card.operation)
    const rows = Array.isArray(card.operations) ? card.operations : []
    const subjects = rows
      .filter(isRecord)
      .map((row) => asString(row.document) ?? asString(row.folder_name))
      .filter((subject): subject is string => subject !== undefined)
      .slice(0, 3)
    if (!title && !operation) return null
    const named = subjects.length > 0 ? ` (${subjects.join('; ')})` : ''
    const why = reasonOf(rows)
    return { kind: 'files', content: `${title ?? operation}${named}${why}` }
  }
  return null
}

interface DecidedProposal {
  decidedAt: string
  item: DigestLineItem
  suffix?: string
  maxChars?: number
}

function decisionsOf(metadata: unknown, fallbackDate: Date): DecidedProposal[] {
  if (!isRecord(metadata) || !isRecord(metadata.cardInteractions)) return []
  const cards = Array.isArray(metadata.cards) ? metadata.cards : []
  const out: DecidedProposal[] = []
  for (const [key, interaction] of Object.entries(metadata.cardInteractions)) {
    if (!isRecord(interaction)) continue
    const decision = asString(interaction.decision)
    const verdict = decision ? verdictOf(decision) : null
    if (!verdict) continue
    const index = Number(key.slice(key.lastIndexOf('-') + 1))
    const card = Number.isInteger(index) ? cards[index] : undefined
    if (!isRecord(card)) continue
    if (asString(card.proposal_id)) continue
    const described = describeCard(card)
    if (!described) continue
    const decidedAt = instantOf(interaction.decidedAt) ?? fallbackDate.toISOString()
    out.push({
      decidedAt,
      item: { tags: [verdict, described.kind, decidedAt.slice(0, 10)], content: described.content },
    })
  }
  return out
}

const FILE_OPERATION_LABELS: Record<string, string> = {
  move: 'Move',
  rename: 'Rename',
  create_folder: 'Create folder',
  assign: 'Assign',
}

function describeProfilePatch(payload: Record<string, unknown>): string {
  const title = asString(payload.title) ?? 'Update project context'
  const operations = (Array.isArray(payload.patch) ? payload.patch : []).flatMap((operation) => {
    const parsed = ProjectProfilePatchOperationSchema.safeParse(operation)
    return parsed.success ? [parsed.data] : []
  })
  let lines: string[] = []
  try {
    lines = buildPatchPreviewRows(operations, null)
      .filter((row) => row.label && row.after)
      .map((row) => (row.after === row.label ? row.label : `${row.label}: → ${row.after}`))
      .slice(0, 3)
  } catch {
    // A value the formatters cannot read costs the detail, never the line.
  }
  return lines.length > 0 ? `${title} (${lines.join('; ')})` : title
}

function reasonOf(rows: readonly unknown[]): string {
  const reason = rows.filter(isRecord).map((row) => asString(row.reason)).find((value) => value !== undefined)
  return reason ? ` — reason: ${reason}` : ''
}

function describeFileOperation(payload: Record<string, unknown>): string | null {
  const operation = asString(payload.operation)
  const label = operation ? (FILE_OPERATION_LABELS[operation] ?? operation) : null
  const items = (Array.isArray(payload.operations) ? payload.operations : []).filter(isRecord)
  const subjects = items
    .map((item) => {
      const subject = asString(item.document) ?? asString(item.folder_name)
      const renamed = asString(item.new_display_name)
      return subject && renamed && operation === 'rename' ? `${subject} → ${renamed}` : subject
    })
    .filter((subject): subject is string => subject !== undefined)
    .slice(0, 3)
  const target = items.length > 0 ? (asString(items[0].target_folder) ?? asString(items[0].member)) : undefined
  if (!label && subjects.length === 0) return null
  const named = subjects.length > 0 ? ` (${subjects.join('; ')})` : ''
  return `${label ?? 'File change'}${named}${target ? ` → ${target}` : ''}${reasonOf(items)}`
}

function describePayload(kind: string, payload: unknown): { kind: string; content: string } | null {
  if (!isRecord(payload)) return null
  if (kind === 'project_profile') return { kind: 'profile', content: describeProfilePatch(payload) }
  if (kind === 'memory') {
    const content = asString(payload.content)
    return content ? { kind: 'note', content } : null
  }
  if (kind === 'file_operation') {
    const content = describeFileOperation(payload)
    return content ? { kind: 'files', content } : null
  }
  if (kind === 'operation') {
    const content = asString(payload.summary)
    return content ? { kind: 'action', content } : null
  }
  return null
}

function decisionOfRow(row: DecidedProposalRow): DecidedProposal | null {
  const described = describePayload(row.kind, row.payload)
  if (!described || Number.isNaN(row.decidedAt.getTime())) return null
  const decidedAt = row.decidedAt.toISOString()
  const verdict = row.status === 'dismissed' ? 'declined' : 'accepted'
  return {
    decidedAt,
    item: { tags: [verdict, described.kind, decidedAt.slice(0, 10)], content: described.content },
    suffix: row.status === 'partially_applied' ? ' (partially applied)' : undefined,
    maxChars: ROW_LINE_MAX_CHARS,
  }
}

export async function buildProposalDecisionsBlock(
  projectId: string,
  organizationId: string,
): Promise<string | null> {
  const [messageRows, proposalRows] = await Promise.all([
    listRecentMessagesWithCardDecisions(projectId, organizationId, MESSAGE_SCAN_LIMIT),
    listRecentDecidedProposals(projectId, organizationId, MESSAGE_SCAN_LIMIT),
  ])
  const decided = [
    ...messageRows.flatMap((row) => decisionsOf(row.metadata, row.createdAt)),
    ...proposalRows.flatMap((row) => decisionOfRow(row) ?? []),
  ]
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : a.decidedAt > b.decidedAt ? -1 : 0))
    .slice(0, MAX_DECISIONS)
  const masked = await Promise.all(
    decided.map(async ({ item, suffix, maxChars }) => {
      const { text } = await maskChatText(organizationId, item.content)
      const cut = maxChars && text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
      return { ...item, content: `${cut}${suffix ?? ''}` }
    }),
  )
  return formatBoundedDigest(PROPOSAL_DECISIONS_HEADER, masked, DIGEST_BLOCK_MAX_CHARS)
}

export function composeMemoryContext(
  digest: string | null,
  decisions: string | null,
  reviewDecisions: string | null = null,
  folderDescriptions: string | null = null,
): string | null {
  const parts = [digest, decisions, reviewDecisions, folderDescriptions].filter((part): part is string =>
    Boolean(part && part.trim()),
  )
  return parts.length > 0 ? parts.join('\n\n') : null
}
