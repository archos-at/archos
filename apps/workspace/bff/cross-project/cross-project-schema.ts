import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { CROSS_PROJECT_WIRE_SCHEMAS } from './types'

export function crossProjectJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(CROSS_PROJECT_WIRE_SCHEMAS, {
    title: 'Grid cross-project lookups wire contract',
    description:
      'Generated from apps/workspace/bff/cross-project/types.ts. Do not edit by hand: ' +
      'cross-project-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
