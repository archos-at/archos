import { putNormRegistryBodySchema, verifyNormRequestSchema } from '@/lib/norms/schemas'
import type { AgentOperation } from '../operation'

export const platformNormOperations = [
  {
    name: 'platform-norm-registry-get',
    domain: 'platform',
    summary: 'Read the norm registry',
    description:
      'The registry of building-law norms the agent cites, with its version number. Read it before platform-norm-registry-update, ' +
      'which writes the whole registry back at the next version.',
    method: 'GET',
    path: '/api/platform/norms',
    load: () => import('@/app/api/platform/norms/route'),
  },
  {
    name: 'platform-norm-registry-update',
    domain: 'platform',
    summary: 'Replace the norm registry',
    description:
      'Writes the complete norm registry (`{ version, registry }`) as read from platform-norm-registry-get; a stale version, or ' +
      'any write once platform knowledge is on (use platform-knowledge-change-request-create), is refused (409). Audited.',
    method: 'PUT',
    path: '/api/platform/norms',
    body: putNormRegistryBodySchema,
    destructive: true,
    load: () => import('@/app/api/platform/norms/route'),
  },
  {
    name: 'platform-norm-verify',
    domain: 'platform',
    summary: 'Check a norm against the legal source',
    description:
      'Looks a norm up by title and application and returns the candidates the legal source offers, so an entry can be ' +
      'confirmed before it enters the registry. Changes nothing.',
    method: 'POST',
    path: '/api/platform/norms/verify',
    body: verifyNormRequestSchema,
    readOnly: true,
    load: () => import('@/app/api/platform/norms/verify/route'),
  },
] as const satisfies readonly AgentOperation[]
