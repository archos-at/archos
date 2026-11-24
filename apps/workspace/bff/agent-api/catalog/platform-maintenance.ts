import type { AgentOperation } from '../operation'

export const platformMaintenanceOperations = [
  {
    name: 'platform-kill-runs',
    domain: 'platform',
    summary: 'Kill switch: stop every running deep research',
    description:
      'Interrupts every running deep research in every organization, stops its worker and closes the run as `interrupted`. ' +
      'It cannot be undone and hits all tenants; use it only for a runaway cost or an outage. Returns what it stopped.',
    method: 'POST',
    path: '/api/platform/maintenance/kill-runs',
    destructive: true,
    load: () => import('@/app/api/platform/maintenance/kill-runs/route'),
  },
  {
    name: 'platform-vectors-reconcile',
    domain: 'platform',
    summary: 'Delete orphaned vector chunks',
    description:
      'Deletes vector-store chunks whose owning document row no longer exists, the residue of past deletes. ' +
      'The deleted chunks cannot be restored. Returns the counts.',
    method: 'POST',
    path: '/api/platform/maintenance/reconcile-vectors',
    destructive: true,
    load: () => import('@/app/api/platform/maintenance/reconcile-vectors/route'),
  },
] as const satisfies readonly AgentOperation[]
