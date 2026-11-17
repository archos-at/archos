import 'server-only'
import { UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { callOperation, OperationInputError, validateOperationInput } from '@/lib/agent-api/dispatch'
import { findOperation } from '@/lib/agent-api/catalog'
import { annotationsOf, type AgentOperation } from '@/lib/agent-api/operation'
import { isOnDoor } from '@/lib/agent-api/exposure'
import { isAgentAskOperation } from '@/lib/agent-asks/ask-wire'
import type { OperationPayload, ProposedChangeResult } from './types'
import { PRODUCT_NAME } from '@/lib/brand'

export const AGENT_ASK_REFUSAL =
  PRODUCT_NAME + ' cannot ask ' + PRODUCT_NAME + ': an ask is how another agent consults ' + PRODUCT_NAME + ', and a turn may not start another.'

export const PROPOSAL_DECISION_OPERATIONS: ReadonlySet<string> = new Set([
  'proposal-apply',
  'proposal-dismiss',
  'agent-change-undo',
])

export const PROPOSAL_DECISION_REFUSAL =
  PRODUCT_NAME + ' cannot apply, dismiss or undo a change for the person: they decide that themselves, on its own card.'

function unusableReason(op: AgentOperation | undefined, name: string): string | null {
  if (isAgentAskOperation(name)) return AGENT_ASK_REFUSAL
  if (!op || !isOnDoor(op.name)) return `The operation ${name} no longer exists`
  if (annotationsOf(op).readOnlyHint) return `The operation ${name} only reads, so there is nothing to apply`
  if (op.sensitivity) return `The operation ${name} is not one ${PRODUCT_NAME} may propose; make the change in ${PRODUCT_NAME} yourself`
  if (PROPOSAL_DECISION_OPERATIONS.has(op.name)) return PROPOSAL_DECISION_REFUSAL
  return null
}

function usableOperation(name: string): { op: AgentOperation } | { reason: string } {
  const op = findOperation(name)
  const reason = unusableReason(op, name)
  return reason || !op ? { reason: reason ?? `The operation ${name} no longer exists` } : { op }
}

export function requireProposableOperation(payload: OperationPayload): void {
  const found = usableOperation(payload.operation)
  if ('reason' in found) throw new UnprocessableError(found.reason, { reason: 'proposal-operation-unusable' })
  try {
    validateOperationInput(found.op, payload.input)
  } catch (error) {
    if (error instanceof OperationInputError) {
      throw new UnprocessableError(error.message, { reason: 'proposal-operation-input' })
    }
    throw error
  }
}

function routeMessage(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const message = (body as { error: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return `The operation failed (${status})`
}

const failed = (label: string, reason: string): ProposedChangeResult[] => [{ label, ok: false, reason }]

export async function applyOperation(
  payload: OperationPayload,
  context: { session: AuthorizedSession; proposalId?: string }
): Promise<ProposedChangeResult[]> {
  const label = payload.summary
  const found = usableOperation(payload.operation)
  if ('reason' in found) return failed(label, found.reason)
  try {
    const origin = context.proposalId ? { proposalId: context.proposalId } : {}
    const result = await callOperation(found.op, payload.input, context.session, 'person', origin)
    return result.ok ? [{ label, ok: true }] : failed(label, routeMessage(result.status, result.body))
  } catch (error) {
    if (error instanceof OperationInputError) return failed(label, error.message)
    throw error
  }
}
