import 'server-only'
import type { OperationInput } from './dispatch'

type Stamp = (input: OperationInput, conversationId: string) => OperationInput

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const STAMPS: Readonly<Partial<Record<string, Stamp>>> = {
  'diagram-file': (input, conversationId) => ({ ...input, body: { ...asRecord(input.body), conversationId } }),
  'document-upload': (input, conversationId) => {
    const body = asRecord(input.body)
    return { ...input, body: { ...body, fields: { ...asRecord(body.fields), originConversationId: conversationId } } }
  },
}

export function withConversationOrigin(
  op: { readonly name: string },
  input: OperationInput,
  conversationId: string | null | undefined,
): OperationInput {
  const stamp = STAMPS[op.name]
  return stamp && conversationId ? stamp(input, conversationId) : input
}
