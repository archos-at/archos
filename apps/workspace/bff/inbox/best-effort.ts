import 'server-only'
import { getTenantContext, withTenant } from '@/lib/db/tenant-context'

export async function bestEffortInbox(
  label: string,
  organizationId: string,
  write: () => Promise<unknown>
): Promise<void> {
  try {
    if (getTenantContext()) await write()
    else await withTenant({ organizationId }, write)
  } catch (cause) {
    console.error(`[inbox] ${label} could not be written:`, cause)
  }
}
