import 'server-only'
import type { TaskDefinition } from '@/lib/db/schema/task-model'
import * as tasks from '@/lib/tasks/repository'
import { hatchetClient } from '@/lib/jobs-queue/orchestrator'
import { setScheduledRunId } from './repository'

export const FIRE_TASK_DEFINITION = 'fire-task-definition'

export interface FireTaskDefinitionInput {
  definition_id: string
  organization_id: string
  due_at: string
  [key: string]: string
}

type ScheduledDefinition = Pick<TaskDefinition, 'id' | 'organizationId' | 'enabled' | 'nextRunAt' | 'scheduledRunId'>

const LOG = '[scheduling]'

const isNotFound = (error: unknown): boolean => (error as { response?: { status?: number } } | null)?.response?.status === 404

async function deleteScheduledRun(scheduledRunId: string): Promise<void> {
  try {
    await hatchetClient().scheduled.delete(scheduledRunId)
  } catch (error) {
    if (isNotFound(error)) return
    console.warn(`${LOG} could not delete scheduled run ${scheduledRunId}:`, error instanceof Error ? error.message : error)
  }
}

export async function syncScheduledRun(definition: ScheduledDefinition, now: Date = new Date()): Promise<void> {
  if (definition.scheduledRunId) await deleteScheduledRun(definition.scheduledRunId)
  const due = definition.enabled ? definition.nextRunAt : null
  let scheduledRunId: string | null = null
  try {
    if (due) {
      const input: FireTaskDefinitionInput = {
        definition_id: definition.id,
        organization_id: definition.organizationId,
        due_at: due.toISOString(),
      }
      const created = await hatchetClient().scheduled.create(FIRE_TASK_DEFINITION, {
        triggerAt: new Date(Math.max(due.getTime(), now.getTime())),
        input,
        additionalMetadata: { definition_id: definition.id },
      })
      scheduledRunId = created.metadata.id
    }
    if (scheduledRunId !== definition.scheduledRunId) {
      await setScheduledRunId(definition.id, definition.organizationId, scheduledRunId)
    }
  } catch (error) {
    console.error(`${LOG} could not schedule definition ${definition.id}; the repair sweep will:`, error)
  }
}

export async function dropScheduledRun(definition: Pick<TaskDefinition, 'scheduledRunId'>): Promise<void> {
  if (definition.scheduledRunId) await deleteScheduledRun(definition.scheduledRunId)
}

export async function rearmOneShotsSkippedWhileParked(projectId: string, organizationId: string): Promise<number> {
  const rearmed = await tasks.rearmOneShotsSkippedWhileParked(projectId, organizationId)
  for (const definition of rearmed) await syncScheduledRun(definition)
  return rearmed.length
}
