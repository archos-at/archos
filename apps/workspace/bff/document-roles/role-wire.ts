import { z } from 'zod'
import { canonicalDocumentRole, DOCUMENT_ROLES } from '@/lib/project-profile/document-roles'

export const declareDocumentRoleSchema = z.object({
  documentId: z.guid(),
  role: z.preprocess(canonicalDocumentRole, z.enum(DOCUMENT_ROLES)),
  scopeInstanceId: z.string().min(1).max(64).nullable().optional(),
})
