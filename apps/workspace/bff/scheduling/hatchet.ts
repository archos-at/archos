/**
 * The one seam between scheduling and the Hatchet SDK (ADR-0150).
 *
 * Everything in `bff/scheduling/` reaches Hatchet through {@link schedulingHatchet}:
 * the task declarations (`./tasks.ts`) and the scheduled runs of task
 * definitions (`./scheduled-runs.ts`). The wiring spec replaces it with
 * {@link setSchedulingHatchetForTests}; the integration specs use the real one.
 *
 * The connection is the SDK's own environment (`HATCHET_CLIENT_TOKEN`,
 * `HATCHET_CLIENT_HOST_PORT`, `HATCHET_CLIENT_TLS_STRATEGY`,
 * `HATCHET_CLIENT_NAMESPACE`), read by `HatchetClient.init()` on first use. The
 * SDK is imported on first use too, so a request that never schedules anything
 * never loads its gRPC stack.
 */

import 'server-only'
import type { HatchetClient } from '@hatchet-dev/typescript-sdk/v1'

/** What scheduling uses of the client: declaring tasks, and the scheduled-run API. */
export type SchedulingHatchet = Pick<HatchetClient, 'task' | 'scheduled'>

let client: Promise<SchedulingHatchet> | null = null

export function schedulingHatchet(): Promise<SchedulingHatchet> {
  client ??= import('@hatchet-dev/typescript-sdk/v1')
    .then(({ HatchetClient: sdk }): SchedulingHatchet => sdk.init())
    .catch((error: unknown) => {
      // Not cached: a missing token or an unreachable engine is tried again on the next call.
      client = null
      throw error
    })
  return client
}

/** Replace the client (a fake in the wiring spec); `null` goes back to the real one. */
export function setSchedulingHatchetForTests(fake: SchedulingHatchet | null): void {
  client = fake ? Promise.resolve(fake) : null
}
