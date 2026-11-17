import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { turnOutcomeRequestSchema, turnOutcomeResponseSchema } from './outcome-types'

export const TURN_OUTCOME_WIRE_SCHEMAS = {
  TurnOutcomeRequest: turnOutcomeRequestSchema,
  TurnOutcomeResponse: turnOutcomeResponseSchema,
} as const

export function turnOutcomeJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(TURN_OUTCOME_WIRE_SCHEMAS, {
    title: 'Grid turn outcome wire contract',
    description:
      'Generated from apps/workspace/bff/turns/outcome-types.ts. Do not edit by hand: ' +
      'outcome-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
