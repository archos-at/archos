import { jsonSchemaDocument, type JsonSchemaNode } from '@/lib/api/zod-json-schema'
import {
  applyProposalRequestSchema,
  fileOperationPayloadSchema,
  memoryPayloadSchema,
  projectProfilePayloadSchema,
  internalProposalRequestSchema,
  internalProposalResponseSchema,
  proposalResponseSchema,
  proposedChangeViewSchema,
} from './types'

export const PROPOSAL_WIRE_SCHEMAS = {
  InternalProposalRequest: internalProposalRequestSchema,
  InternalProposalResponse: internalProposalResponseSchema,
  FileOperationPayload: fileOperationPayloadSchema,
  MemoryPayload: memoryPayloadSchema,
  ProjectProfilePayload: projectProfilePayloadSchema,
  ApplyProposalRequest: applyProposalRequestSchema,
  ProposedChangeView: proposedChangeViewSchema,
  ProposalResponse: proposalResponseSchema,
} as const

export function proposalsJsonSchema(): JsonSchemaNode {
  return jsonSchemaDocument(PROPOSAL_WIRE_SCHEMAS, {
    title: 'Grid proposed changes wire contract',
    description:
      'Generated from apps/workspace/bff/proposals/types.ts. Do not edit by hand: ' +
      'proposal-schema.spec.ts rewrites this file and fails when it is stale.',
  })
}
