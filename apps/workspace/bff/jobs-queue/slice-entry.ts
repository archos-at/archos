import 'server-only'
import { bootLine } from '@/lib/boot'
import { bootstrapPlatformModelDefaults } from '@/lib/model-config/bootstrap-defaults'
import { shutdownPosthogServer } from '@/lib/analytics/posthog-server'
import { schedulingTasks } from '@/lib/scheduling/tasks'
import { startBffJobWorker } from './orchestrator'
import { dispatchStrandedJobs, releaseInFlightJobs, runBffJobTask } from './task-run'

export async function initSliceHost(): Promise<void> {
  // oxlint-disable-next-line no-console -- the boot line is info on stdout, as in instrumentation.ts
  console.log(bootLine())
  try {
    await bootstrapPlatformModelDefaults()
  } catch (error) {
    console.error('[Model Config] Could not run the platform default bootstrap:', error)
  }
}

export async function shutdownSliceHost(): Promise<void> {
  await releaseInFlightJobs()
  await shutdownPosthogServer()
}

export async function startJobWorker(name: string) {
  return startBffJobWorker(name, { run: runBffJobTask, sweep: dispatchStrandedJobs }, schedulingTasks())
}

export { rederiveBuildingClasses } from '@/lib/project-intake/rederive'
