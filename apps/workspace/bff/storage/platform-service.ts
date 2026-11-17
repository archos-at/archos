import 'server-only'
import { aggregateStorageUsageByOrganization } from './repository'
import { STORAGE_QUOTA_SETTING, effectiveQuotaFromSettings } from './service'
import {
  configuredUploadLimit,
  effectiveUploadLimit,
  uploadLimitBounds,
  type UploadLimitBounds,
} from './upload-limit'
import { findOrganizations, ORGANIZATION_PAGE_MAX } from '@/lib/organizations/repository'
import { getOrganizationDisplayNames } from '@/lib/organizations/display-names'

export interface OrganizationStorageRow {
  organizationId: string
  displayName: string | null
  usedBytes: number
  documents: number
  quotaBytes: number | null
  inherited: boolean
  maxUploadFileBytes: number | null
  effectiveMaxUploadFileBytes: number
}

export interface PlatformStorageOverview {
  organizations: OrganizationStorageRow[]
  totals: {
    usedBytes: number
    documents: number
    organizations: number
  }
  truncated: boolean
  uploadLimit: UploadLimitBounds
}

export async function getPlatformStorageOverview(): Promise<PlatformStorageOverview> {
  const [usageByOrg, page] = await Promise.all([
    aggregateStorageUsageByOrganization(),
    findOrganizations(ORGANIZATION_PAGE_MAX),
  ])

  const settingsById = new Map(
    page.organizations.map((org) => [
      org.workosOrganizationId,
      (org.settings as Record<string, unknown> | null) ?? {},
    ]),
  )
  const names = new Map(
    page.organizations.map((org) => [org.workosOrganizationId, org.displayName ?? null]),
  )

  const ids = new Set<string>([...usageByOrg.keys(), ...settingsById.keys()])
  const resolved = await getOrganizationDisplayNames([...ids].filter((id) => !names.get(id)))
  const bounds = uploadLimitBounds()

  const rows = [...ids].map((organizationId): OrganizationStorageRow => {
    const usage = usageByOrg.get(organizationId)
    const settings = settingsById.get(organizationId) ?? {}
    const ownUploadLimit = configuredUploadLimit(settings)

    return {
      organizationId,
      displayName: names.get(organizationId) ?? resolved.get(organizationId) ?? null,
      usedBytes: usage?.bytes ?? 0,
      documents: usage?.documents ?? 0,
      quotaBytes: effectiveQuotaFromSettings(settings),
      inherited: !(STORAGE_QUOTA_SETTING in settings),
      maxUploadFileBytes: ownUploadLimit,
      effectiveMaxUploadFileBytes: effectiveUploadLimit(ownUploadLimit, bounds),
    }
  })

  rows.sort((a, b) => b.usedBytes - a.usedBytes)

  return {
    organizations: rows,
    totals: {
      usedBytes: rows.reduce((sum, row) => sum + row.usedBytes, 0),
      documents: rows.reduce((sum, row) => sum + row.documents, 0),
      organizations: rows.length,
    },
    truncated: page.truncated,
    uploadLimit: bounds,
  }
}
