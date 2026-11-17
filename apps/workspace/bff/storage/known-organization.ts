import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import { findOrganization } from '@/lib/organizations/repository'
import { aggregateStorageUsage, type StorageUsageByScope } from './repository'

export async function readKnownOrganizationUsage(
  organizationId: string
): Promise<StorageUsageByScope> {
  const usage = await aggregateStorageUsage(organizationId)
  if (usage.total.documents === 0 && (await findOrganization(organizationId)) === null) {
    throw new NotFoundError('Organization not found')
  }
  return usage
}
