import 'server-only'
import { isOutsideTenantSlot } from '@/lib/best-effort'
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
    if (isOutsideTenantSlot(cause)) throw cause
    console.error(`[inbox] ${label} could not be written:`, cause)
  }
}
