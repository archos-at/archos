/**
 * The `bff-jobs` pod's door to the BFF's services (ADR-0079 amendment 1, ADR-0150).
 *
 * `scripts/build-jobs-bundle.ts` bundles this module, and everything it reaches,
 * into `dist-jobs/slice.mjs`, which `workers/jobs/index.js` imports. The pod
 * then runs the Hatchet worker for `bff-job` in its own process, with the
 * services the routes use, and never boots the Next server.
 *
 * Not imported by the Next app: a caller is `scripts/build-jobs-bundle.ts`.
 */

import 'server-only'
import { bootLine } from '@/lib/boot'
import { bootstrapPlatformModelDefaults } from '@/lib/model-config/bootstrap-defaults'
import { shutdownPosthogServer } from '@/lib/analytics/posthog-server'
import { schedulingTasks } from '@/lib/scheduling/tasks'
import { startBffJobWorker } from './hatchet'
import { dispatchStrandedJobs, runBffJobTask } from './hatchet-run'

/**
 * What `instrumentation.ts` `register()` does for a Next server, minus what a
 * job host has no use for (request-error capture; the supervisor already
 * bridges console to OTLP logs). Never rejects: a failed bootstrap leaves the
 * workflow config in charge, as it does for the server.
 */
export async function initSliceHost(): Promise<void> {
  // oxlint-disable-next-line no-console -- the boot line is info on stdout, as in instrumentation.ts
  console.log(bootLine())
  try {
    await bootstrapPlatformModelDefaults()
  } catch (error) {
    console.error('[Model Config] Could not run the platform default bootstrap:', error)
  }
}

/** Flush what the runs queued for PostHog, as `server.js` does with `__appShutdownHooks`. */
export async function shutdownSliceHost(): Promise<void> {
  await shutdownPosthogServer()
}

/**
 * Start the Hatchet worker that runs `bff-job` and the scheduling tasks (a
 * definition's fire, the maintenance sweeps), and the sweep that dispatches
 * stranded rows.
 */
export async function startJobWorker(name: string) {
  return startBffJobWorker(name, { run: runBffJobTask, sweep: dispatchStrandedJobs }, schedulingTasks())
}
