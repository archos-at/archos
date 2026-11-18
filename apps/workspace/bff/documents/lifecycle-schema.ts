import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { DOCUMENT_LIFECYCLE_WIRE_SCHEMAS } from './lifecycle-types'

export { toJsonSchema, UnsupportedSchemaNodeError } from '@/lib/api/zod-json-schema'
export type { JsonSchemaNode } from '@/lib/api/zod-json-schema'

export function documentLifecycleJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(DOCUMENT_LIFECYCLE_WIRE_SCHEMAS, {
    title: 'Grid document lifecycle wire contract',
    description:
      'Generated from apps/workspace/bff/documents/lifecycle-types.ts. Do not edit by hand: ' +
      'lifecycle-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
