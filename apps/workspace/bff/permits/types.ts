import { z } from 'zod'
import { isoDay } from '@/lib/cross-project/types'
import { normalizeProfileToken } from '@/lib/project-profile/legacy-names'
import {
  canonicalPermitRecordKind,
  canonicalPermitRequirementKind,
  PERMIT_RECORD_KINDS,
  PERMIT_REQUIREMENT_KINDS,
  PERMIT_REQUIREMENT_MAX_CHARS,
} from '@/lib/db/schema/permit-records'

export const PERMIT_MAX_REQUIREMENTS = 60

const text = (max: number) => z.string().trim().min(1).max(max)

export const permitRequirementSchema = z.object({
  kind: z.preprocess(canonicalPermitRequirementKind, z.enum(PERMIT_REQUIREMENT_KINDS)),
  content: text(PERMIT_REQUIREMENT_MAX_CHARS),
  evidence: text(PERMIT_REQUIREMENT_MAX_CHARS).nullable(),
  legalBasis: text(300).nullable(),
  page: z.number().int().min(1).max(100_000).nullable(),
})

function renameLegacyPermitFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('bundesland' in value)) return value
  const { bundesland, ...rest } = value as Record<string, unknown>
  return {
    ...rest,
    federalState: typeof bundesland === 'string' ? normalizeProfileToken('federal_state', bundesland) : bundesland,
  }
}

export const permitRecordSchema = z.preprocess(renameLegacyPermitFields, z.object({
  kind: z.preprocess(canonicalPermitRecordKind, z.enum(PERMIT_RECORD_KINDS)),
  authority: text(300).nullable(),
  municipality: text(200).nullable(),
  federalState: text(50).nullable(),
  issuedOn: isoDay.nullable(),
  reference: text(200).nullable(),
  requirements: z.array(permitRequirementSchema).max(PERMIT_MAX_REQUIREMENTS),
}))

export const storePermitRecordRequestSchema = z.object({
  organizationId: z.string().min(1).max(200),
  documentId: z.guid().optional(),
  collection: z.string().min(1).max(300),
  fileName: text(512),
  model: z.string().trim().max(200),
  record: permitRecordSchema.nullable(),
}).refine((body) => body.record === null || body.model.length > 0, {
  path: ['model'],
  message: 'model is required with a record',
})

export type PermitRecordBody = z.infer<typeof permitRecordSchema>
export type StorePermitRecordRequest = z.infer<typeof storePermitRecordRequestSchema>

export interface StorePermitRecordResponse {
  stored: boolean
  requirements: number
}
