import { internalApiRoute } from '@/lib/api/handler'
import { runStorageAlertSweep } from '@/lib/storage/alerts'

export const POST = internalApiRoute(
  'StorageAlerts',
  () => runStorageAlertSweep(),
  {
    tenancy: {
      crossTenant:
        'discovery only: one grouped aggregate of stored bytes across every organization. ' +
        'The sweep then re-enters each organization with withTenant, so the per-org quota ' +
        'read and the inbox writes are still subject to row-level security',
    },
  },
)
