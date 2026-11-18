import 'server-only'

import { z } from 'zod'
import { type JsonSchemaNode, toJsonSchema } from '@/lib/api/zod-json-schema'
import { IDEMPOTENCY_KEY_SCHEMA } from './door-idempotency'
import { type AgentOperation, annotationsOf } from './operation'

export const IF_MATCH_MAX_LENGTH = 256

const IF_MATCH_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: IF_MATCH_MAX_LENGTH,
  description: 'Sent as If-Match: the version you read. A write over a newer one is refused (409); read again, then retry.',
} as const

const schemaCache = new Map<string, JsonSchemaNode>()

function part(schema: Parameters<typeof toJsonSchema>[0]): { node: JsonSchemaNode; required: boolean } {
  try {
    return { node: toJsonSchema(schema), required: !z.safeParse(schema, {}).success }
  } catch {
    return { node: { description: 'Shape not describable here; the route validates it.' }, required: false }
  }
}

export function inputSchemaOf(op: AgentOperation): JsonSchemaNode {
  const cached = schemaCache.get(op.name)
  if (cached) return cached
  const properties: Record<string, JsonSchemaNode> = {}
  const required: string[] = []
  for (const key of ['params', 'query', 'body'] as const) {
    const schema = op[key]
    if (!schema) continue
    const { node, required: isRequired } = part(schema)
    properties[key] = node
    if (isRequired) required.push(key)
  }
  if (op.ifMatchHeader) properties.ifMatch = IF_MATCH_SCHEMA
  if (!annotationsOf(op).readOnlyHint) properties.idempotencyKey = IDEMPOTENCY_KEY_SCHEMA
  const schema: JsonSchemaNode = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) schema.required = required
  if (op.examples && op.examples.length > 0) schema.examples = op.examples as unknown as JsonSchemaNode
  schemaCache.set(op.name, schema)
  return schema
}
