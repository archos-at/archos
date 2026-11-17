import 'server-only'

import { ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { withTenant } from '@/lib/db/tenant-context'
import { createProposal } from '@/lib/proposals/service'
import { MAX_OPERATION_SUMMARY_LENGTH, type OperationPayload } from '@/lib/proposals/types'
import type { OperationInput } from './dispatch'
import type { AgentOperation } from './operation'
import { proposalReachRefusal } from './conversation-audience'
import { requireTargetsReadable, targetsOf, TooManyTargetsError } from './operation-targets'
import { PRODUCT_NAME } from '@/lib/brand'

export function sensitiveProposalRefusal(op: Pick<AgentOperation, 'name'>): string {
  return (
    `${PRODUCT_NAME} cannot propose ${op.name}: it changes who may do what, touches the organization's secrets, ` +
    'or turns a security or compliance control down or off, so the person does it in ' + PRODUCT_NAME + ' themselves.'
  )
}

export const MAX_PROPOSED_INPUT_CHARS = 20_000

export function oversizedProposalRefusal(op: Pick<AgentOperation, 'name'>, length: number): string {
  return (
    `The input for ${op.name} is ${length} characters; a proposal the person reads in full on its card holds at most ` +
    `${MAX_PROPOSED_INPUT_CHARS}. Split the change into smaller calls, or let the person make it in ${PRODUCT_NAME} themselves.`
  )
}

const VALUE_LENGTH = 60
const MAX_FACTS = 4

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function factOf(key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).replace(/\s+/g, ' ').trim()
    return text ? `${key}: ${clip(text, VALUE_LENGTH)}` : null
  }
  if (Array.isArray(value)) return `${key}: ${value.length} ${value.length === 1 ? 'item' : 'items'}`
  if (typeof value === 'object') {
    const fields = Object.keys(value)
    return `${key}: ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`
  }
  return null
}

function factsOf(record: unknown): string[] {
  if (typeof record !== 'object' || record === null) return []
  if (Array.isArray(record)) return [factOf('body', record)].filter((fact): fact is string => fact !== null)
  return Object.entries(record).flatMap(([key, value]) => {
    const fact = factOf(key, value)
    return fact ? [fact] : []
  })
}

export function summaryOfOperation(op: AgentOperation, input: OperationInput): string {
  const all = [...factsOf(input.body), ...factsOf(input.query), ...factsOf(input.params)]
  const facts = all.slice(0, MAX_FACTS)
  if (all.length > facts.length) facts.push(`+${all.length - facts.length} more`)
  const line = facts.length > 0 ? `${op.summary.replace(/\.$/, '')} (${facts.join(', ')})` : op.summary
  return clip(line, MAX_OPERATION_SUMMARY_LENGTH)
}

export async function proposeOperation({
  principal,
  op,
  input,
}: {
  principal: {
    session: AuthorizedSession
    conversationId?: string | null
    projectId?: string | null
    answerMessageId?: string | null
  }
  op: AgentOperation
  input: OperationInput
}): Promise<{ proposalId: string; summary: string }> {
  if (op.sensitivity) throw new ForbiddenError(sensitiveProposalRefusal(op))
  const stored: OperationPayload['input'] = {
    params: input.params,
    query: input.query,
    body: input.body,
    ...(input.ifMatch ? { ifMatch: input.ifMatch } : {}),
  }
  const length = JSON.stringify(stored).length
  if (length > MAX_PROPOSED_INPUT_CHARS) {
    throw new UnprocessableError(oversizedProposalRefusal(op, length), { reason: 'proposal-input-too-long' })
  }
  let targets
  try {
    targets = targetsOf(op, input)
  } catch (error) {
    if (error instanceof TooManyTargetsError) {
      throw new UnprocessableError(error.message, { reason: 'proposal-too-many-targets' })
    }
    throw error
  }
  const summary = summaryOfOperation(op, input)
  const payload: OperationPayload = { operation: op.name, input: stored, summary }
  const { session } = principal
  const row = await withTenant({ organizationId: session.organizationId, userId: session.userId }, async () => {
    await requireTargetsReadable(session, targets)
    const outsideReach = await proposalReachRefusal(principal, targets)
    if (outsideReach) throw new ForbiddenError(outsideReach)
    return createProposal(session, {
      projectId: principal.projectId ?? null,
      kind: 'operation',
      payload,
      conversationId: principal.conversationId ?? null,
      answerMessageId: principal.answerMessageId ?? null,
    })
  })
  return { proposalId: row.id, summary }
}
