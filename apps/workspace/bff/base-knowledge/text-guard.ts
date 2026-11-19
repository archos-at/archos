import 'server-only'
import { licenceMarkOf, textUseOf, type LicenceMark } from './office/text-use'
import { copyForDocument, documentsWithEntries, type DocumentCopy } from './store/repository'
import { ASK_FOR_LICENCE } from './wire/licence-step'

export { licenceMarkFields } from './office/text-use'

export function textHeldFor(copy: DocumentCopy | null): boolean {
  return copy !== null && (!copy.confirmed || textUseOf(copy.licenceClass, copy.terms, ASK_FOR_LICENCE) === 'metadata_only')
}

export async function isTextHeld(organizationId: string, documentId: string): Promise<boolean> {
  try {
    return textHeldFor(await copyForDocument(organizationId, documentId))
  } catch {
    return true
  }
}

export async function heldAmong(organizationId: string, documentIds: readonly string[]): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set()
  try {
    const copies = await documentsWithEntries(organizationId, documentIds)
    const held = await Promise.all(copies.map(async (id) => ((await isTextHeld(organizationId, id)) ? [id] : [])))
    return new Set(held.flat())
  } catch {
    return new Set(documentIds)
  }
}

export async function copyMarkForIngest(
  organizationId: string,
  documentId: string
): Promise<(LicenceMark & { editionId: string }) | null> {
  const copy = await copyForDocument(organizationId, documentId)
  return copy?.confirmed ? { ...licenceMarkOf(copy.licenceClass, copy.terms, ASK_FOR_LICENCE), editionId: copy.editionId } : null
}

export async function licenceOfDocument(
  organizationId: string,
  documentId: string
): Promise<(LicenceMark & { licensed: boolean; confirmed: boolean; held: boolean; editionId: string }) | null> {
  const copy = await copyForDocument(organizationId, documentId)
  if (!copy) return null
  return {
    ...licenceMarkOf(copy.licenceClass, copy.terms, ASK_FOR_LICENCE),
    licensed: copy.licenceClass === 'licensed',
    confirmed: copy.confirmed,
    held: textHeldFor(copy),
    editionId: copy.editionId,
  }
}
