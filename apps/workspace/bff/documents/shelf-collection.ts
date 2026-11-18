import 'server-only'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { findProjectInOrg } from '@/lib/projects/repository'
import type { DocumentShelf } from './shelf'

export async function shelfCollectionName(
  shelf: DocumentShelf,
  organizationId: string,
): Promise<string | null> {
  if (shelf.kind === 'office_shelf') return officeShelfCollectionName(organizationId)
  const project = await findProjectInOrg(shelf.projectId, organizationId)
  return project?.collectionName ?? null
}
