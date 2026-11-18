import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import {
  internalIntakeFinishResponseSchema,
  internalIntakeNeedsResponseSchema,
  internalIntakeProgressResponseSchema,
  internalIntakeRecordResponseSchema,
  internalIntakeRequestSchema,
  internalIntakeWithdrawResponseSchema,
  intakeViewSchema,
  needSchema,
  profileEvidenceSchema,
} from './types'

export const INTAKE_WIRE_SCHEMAS = {
  InternalIntakeRequest: internalIntakeRequestSchema,
  InternalIntakeNeedsResponse: internalIntakeNeedsResponseSchema,
  InternalIntakeRecordResponse: internalIntakeRecordResponseSchema,
  InternalIntakeWithdrawResponse: internalIntakeWithdrawResponseSchema,
  InternalIntakeProgressResponse: internalIntakeProgressResponseSchema,
  InternalIntakeFinishResponse: internalIntakeFinishResponseSchema,
  Need: needSchema,
  ProfileEvidence: profileEvidenceSchema,
  IntakeView: intakeViewSchema,
} as const

export function projectIntakeJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(INTAKE_WIRE_SCHEMAS, {
    title: 'Grid project intake wire contract',
    description:
      'Generated from apps/workspace/bff/project-intake/types.ts. Do not edit by hand: ' +
      'intake-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
