export const PERSONAL_SHELF_COLLECTION_PREFIX = 'personal_'

const safe = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_')

export function personalShelfCollectionName(organizationId: string, userId: string): string {
  return `${PERSONAL_SHELF_COLLECTION_PREFIX}${safe(organizationId)}__${safe(userId)}`
}

export const isPersonalShelfCollectionName = (collectionName: string): boolean =>
  collectionName.startsWith(PERSONAL_SHELF_COLLECTION_PREFIX)
