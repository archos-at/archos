import type { ProposedChangeKind, ProposedChangeStatus } from '@/lib/proposals/types'

export const WORKSPACE_BLOCK_HEADER = 'WORKSPACE v1'

export const MAX_WORKSPACE_PROPOSALS = 8

export const MAX_PROPOSAL_LINE_CHARS = 200

export type ConversationAudience = 'solo' | 'shared' | 'unknown'

export interface WorkspaceProposalFact {
  id: string
  kind: ProposedChangeKind
  status: ProposedChangeStatus
  summary: string
  outcome?: string | null
}

export interface WorkspaceFacts {
  organizationRole: string | null
  projectRole: string | null
  project: { id: string; name: string; status: string } | null
  conversation: { id: string; audience: ConversationAudience } | null
  inboxWaiting: number | null
  activeRuns: number | null
  proposals: WorkspaceProposalFact[]
  proposalsTruncated: boolean
  officeConventions?: readonly string[] | null
}

const STATUS_WORDS: Record<ProposedChangeStatus, string> = {
  proposed: 'waiting for the person',
  applied: 'applied',
  partially_applied: 'partly applied',
  failed: 'failed',
  dismissed: 'dismissed by the person',
}

const clip = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function proposalLine(proposal: WorkspaceProposalFact): string {
  const parts = [proposal.id, STATUS_WORDS[proposal.status], `${proposal.kind}: ${clip(proposal.summary, MAX_PROPOSAL_LINE_CHARS)}`]
  if (proposal.outcome && proposal.outcome.trim()) parts.push(clip(proposal.outcome, MAX_PROPOSAL_LINE_CHARS))
  return `- ${parts.join(' · ')}`
}

function audienceLine(conversation: WorkspaceFacts['conversation']): string {
  if (!conversation) return 'conversation: none (a run outside a chat)'
  const audience = {
    solo: 'solo (only the asker reads it)',
    shared: 'shared (others read it, so no workspace read runs here; writes are still proposed)',
    unknown: 'audience unknown (a workspace read may be refused as in a shared conversation)',
  }[conversation.audience]
  return `conversation: ${conversation.id} · ${audience}`
}

export function renderWorkspaceBlock(facts: WorkspaceFacts): string {
  const lines = [
    `${WORKSPACE_BLOCK_HEADER} (the workspace as of this turn; the proposal list is the newest ${MAX_WORKSPACE_PROPOSALS})`,
    `asker: organization role ${facts.organizationRole ?? 'unknown'}` +
      (facts.projectRole ? ` · project role ${facts.projectRole}` : ''),
    facts.project
      ? `project: ${facts.project.name} · id ${facts.project.id} · ${facts.project.status}`
      : 'project: none (the turn runs on the organization)',
    audienceLine(facts.conversation),
  ]
  if (facts.inboxWaiting !== null) lines.push(`inbox: ${facts.inboxWaiting} item(s) wait for the asker`)
  if (facts.activeRuns !== null) lines.push(`runs: ${facts.activeRuns} queued or running in this project`)
  if (facts.conversation) {
    if (facts.proposals.length === 0) {
      lines.push('proposals made in this conversation: none')
    } else {
      lines.push(
        `proposals made in this conversation (newest first${facts.proposalsTruncated ? '; older ones not shown' : ''}):`,
        ...facts.proposals.map(proposalLine)
      )
    }
  }
  if (facts.officeConventions && facts.officeConventions.length > 0) lines.push(...facts.officeConventions)
  return lines.join('\n')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function proposalSummaryOf(kind: ProposedChangeKind, payload: unknown): string {
  const record = isRecord(payload) ? payload : {}
  if (kind === 'operation' && typeof record.summary === 'string') return record.summary
  if (kind === 'memory' && typeof record.content === 'string') return `remember: ${record.content}`
  if (kind === 'project_profile') return 'change the project profile'
  if (kind === 'office_shelf_norm') {
    const count = Array.isArray(record.documents) ? record.documents.length : 1
    return `move ${count} norm(s) into the office shelf`
  }
  if (kind === 'file_operation') {
    const operation = typeof record.operation === 'string' ? record.operation : 'change'
    const count = Array.isArray(record.operations) ? record.operations.length : 1
    return `${operation} ${count} file(s)`
  }
  return kind
}

export function proposalOutcomeOf(results: unknown): string | null {
  if (!Array.isArray(results)) return null
  const said = results.flatMap((result) => {
    if (!isRecord(result)) return []
    if (result.ok === false && typeof result.reason === 'string') return [`failed: ${result.reason}`]
    if (result.ok === true && typeof result.itemId === 'string') return [`created ${result.itemId}`]
    return []
  })
  return said.length > 0 ? said.join('; ') : null
}
