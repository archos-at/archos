import 'server-only'
import { withTenant } from '@/lib/db/tenant-context'
import { fireScheduledJob } from '@/lib/jobs/service'
import { nextDue } from './next-due'
import { report } from './log'
import { advanceDueDefinition, findDefinitionsToRepair } from './repository'
import { syncScheduledRun, type FireTaskDefinitionInput } from './scheduled-runs'

export type FireDefinitionOutcome = Awaited<ReturnType<typeof fireScheduledJob>> | { fired: false; reason: 'not-due' | 'invalid' }

export function fireTaskDefinition(input: FireTaskDefinitionInput, now: Date = new Date()): Promise<FireDefinitionOutcome> {
  return withTenant({ organizationId: input.organization_id }, async () => {
    const taken = await advanceDueDefinition(input.definition_id, input.organization_id, new Date(input.due_at), (row) =>
      nextDue(row, now),
    )
    if (!taken) return { fired: false, reason: 'not-due' }
    await syncScheduledRun(taken.definition, now)
    if (!taken.fire) return { fired: false, reason: 'invalid' }
    return fireScheduledJob(taken.definition)
  })
}

export const REPAIR_GRACE_MINUTES = 3
export const REPAIR_BATCH = 500

export async function repairSchedules(now: Date = new Date()): Promise<number> {
  const missing = await findDefinitionsToRepair(REPAIR_GRACE_MINUTES, REPAIR_BATCH)
  for (const definition of missing) {
    await withTenant({ organizationId: definition.organizationId }, () => syncScheduledRun(definition, now))
  }
  if (missing.length > 0) report(`schedule repair: scheduled ${missing.length} definition(s) that were overdue or had no scheduled run`)
  return missing.length
}
