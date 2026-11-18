import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { ANNOTATION_WIRE_SCHEMAS } from './types'

export function documentAnnotationsJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(ANNOTATION_WIRE_SCHEMAS, {
    title: 'Grid document annotations wire contract',
    description:
      'Generated from apps/workspace/bff/annotations/types.ts. Do not edit by hand: ' +
      'annotation-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
