import 'server-only'
import { sourceFoldersOfCollections } from '@/lib/authz/folder-access'
import { withTenant } from '@/lib/db/tenant-context'
import { embedNotes } from '@/lib/knowledge/embeddings'
import { isForeignKeyViolation } from '@/lib/db/errors'
import { canonicalRestriction } from '@/lib/projects/memory-service'
import {
  deletePermitRecord,
  findPermitDocument,
  replacePermitRecord,
  type PermitDocument,
  type PermitRequirementInput,
} from './repository'
import type { StorePermitRecordRequest, StorePermitRecordResponse } from './types'

const NOT_STORED: StorePermitRecordResponse = { stored: false, requirements: 0 }

function embeddingText(requirement: { content: string; evidence: string | null }): string {
  return [requirement.content, requirement.evidence].filter(Boolean).join('\n')
}

async function restrictionOf(organizationId: string, document: PermitDocument, collection: string): Promise<string[] | null> {
  const sources = await sourceFoldersOfCollections(organizationId, document.projectId, document.projectCollection, [collection])
  return canonicalRestriction([...sources.values()])
}

export async function storePermitRecord(body: StorePermitRecordRequest): Promise<StorePermitRecordResponse> {
  const { organizationId, collection, record } = body
  return withTenant({ organizationId }, async () => {
    const document = await findPermitDocument(organizationId, {
      collectionName: collection,
      documentId: body.documentId,
      fileName: body.fileName,
    })
    if (!document) return NOT_STORED
    const { documentId } = document
    if (!record) {
      await deletePermitRecord(organizationId, documentId)
      return NOT_STORED
    }

    const restrictedFolderIds = await restrictionOf(organizationId, document, collection)
    const embedded = await embedNotes(record.requirements.map(embeddingText))
    const requirements: PermitRequirementInput[] = record.requirements.map((requirement, index) => ({
      ...requirement,
      embedding: embedded?.[index] ?? null,
    }))

    try {
      await replacePermitRecord({
        organizationId,
        projectId: document.projectId,
        documentId,
        collectionName: collection,
        fileName: document.fileName,
        restrictedFolderIds,
        model: body.model,
        kind: record.kind,
        authority: record.authority,
        municipality: record.municipality,
        federalState: record.federalState,
        issuedOn: record.issuedOn,
        reference: record.reference,
        requirements,
      })
    } catch (error) {
      if (isForeignKeyViolation(error)) return NOT_STORED
      throw error
    }
    return { stored: true, requirements: requirements.length }
  })
}
