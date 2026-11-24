import 'server-only'
import { officeShelfCollectionName } from '@/lib/office-shelf/collection'
import { personalShelfCollectionName } from '@/lib/personal-shelf/collection'
import { findProjectInOrg } from '@/lib/projects/repository'
import type { DocumentShelf } from './shelf'

export async function shelfCollectionName(
  shelf: DocumentShelf,
  organizationId: string,
): Promise<string | null> {
  switch (shelf.kind) {
    case 'office_shelf':
      return officeShelfCollectionName(organizationId)
    case 'personal':
      return personalShelfCollectionName(organizationId, shelf.userId)
    case 'project': {
      const project = await findProjectInOrg(shelf.projectId, organizationId)
      return project?.collectionName ?? null
    }
  }
}
