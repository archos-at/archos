export const OFFICE_SHELF_COLLECTION_PREFIX = 'archiv_'

export const OFFICE_SHELF_TARGET_COLLECTION_PREFIX = 'office_shelf_'

export const OFFICE_SHELF_COLLECTION_PREFIXES: readonly string[] = [
  OFFICE_SHELF_TARGET_COLLECTION_PREFIX,
  OFFICE_SHELF_COLLECTION_PREFIX,
]

export const isOfficeShelfCollectionName = (collectionName: string): boolean =>
  OFFICE_SHELF_COLLECTION_PREFIXES.some((prefix) => collectionName.startsWith(prefix))

export function officeShelfOrganizationId(collectionName: string): string | null {
  const prefix = OFFICE_SHELF_COLLECTION_PREFIXES.find((candidate) => collectionName.startsWith(candidate))
  return prefix ? collectionName.slice(prefix.length) || null : null
}
