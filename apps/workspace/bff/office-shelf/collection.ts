import 'server-only'
import {
  OFFICE_SHELF_COLLECTION_PREFIX,
  OFFICE_SHELF_COLLECTION_PREFIXES,
} from './collection-prefix'

export function officeShelfCollectionName(organizationId: string): string {
  const safe = organizationId.replace(/[^A-Za-z0-9_-]/g, '_')
  return `${OFFICE_SHELF_COLLECTION_PREFIX}${safe}`
}

export function officeShelfCollectionNames(organizationId: string): string[] {
  const safe = organizationId.replace(/[^A-Za-z0-9_-]/g, '_')
  return OFFICE_SHELF_COLLECTION_PREFIXES.map((prefix) => `${prefix}${safe}`)
}
