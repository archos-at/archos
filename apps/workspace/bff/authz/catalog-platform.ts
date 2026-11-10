/**
 * The platform tier of the authorization catalog (`./catalog`, ADR-0038,
 * ADR-0016): pure data, read by the app and by `scripts/provision-workos-authz.ts`
 * through `./catalog`, which re-exports it.
 */

import type { PermissionSpec } from './catalog'

/**
 * Platform-tier permissions, only ever on `platform-org` roles. **Enforced by US,
 * not by WorkOS**: on 2026-07-31 the live API accepted an `organization` role
 * holding `project:view`, so a dedicated resource type would buy no guarantee.
 * The line is held by `./platform` (membership of the platform organization
 * before any platform surface answers; a claim alone is never enough) and by
 * `catalog.spec.ts` (no environment-scoped role holds a `platform:*` permission,
 * the ONLY check between a careless provisioning edit and a tenant role carrying
 * platform access). `approve_as_<role>`: the role an approval records is one its
 * approver holds, never what a client sent (ADR-0165).
 */
export const PLATFORM_PERMISSION_SPECS: readonly PermissionSpec[] = [
  {
    slug: 'platform:organizations:view',
    name: 'View all organizations',
    description:
      'Platform tier: see every organization on the platform (directory, members, activity).',
    tier: 'platform',
  },
  {
    slug: 'platform:organizations:manage',
    name: 'Manage any organization',
    description: 'Platform tier: administer any organization (settings, limits, lifecycle).',
    tier: 'platform',
  },
  {
    slug: 'platform:usage:view',
    name: 'View cross-org usage',
    description: 'Platform tier: cross-organization LLM usage, spend, and budget posture.',
    tier: 'platform',
  },
  {
    slug: 'platform:settings:view',
    name: 'View platform settings',
    description:
      'Platform tier: read platform-wide settings, defaults, the base knowledge corpus and the skill catalog. The read half of platform:settings:manage.',
    tier: 'platform',
  },
  {
    slug: 'platform:settings:manage',
    name: 'Manage platform settings',
    description: 'Platform tier: manage platform-wide settings and defaults.',
    tier: 'platform',
  },
  ...(['domain_expert', 'counsel', 'second_reviewer', 'privacy_reviewer'] as const).map((role) => ({
    slug: `platform:knowledge:approve_as_${role}`,
    name: `Approve knowledge as ${role.replaceAll('_', ' ')}`,
    description: `Platform tier: approve a platform knowledge change request in the ${role.replaceAll('_', ' ')} role.`,
    tier: 'platform' as const,
  })),
  {
    slug: 'platform:knowledge:approve_alone',
    name: 'Approve knowledge alone',
    description:
      'Platform tier: approve a knowledge change request one wrote, with a reason, when no second person can. A second review stays due (ADR-0176).',
    tier: 'platform',
  },
  {
    slug: 'platform:observability:view',
    name: 'View LLM observability',
    description:
      'Platform tier: open Langfuse (traces, scores, cost) read-only. Gated at the edge; Langfuse roles decide the rest.',
    tier: 'platform',
  },
]
