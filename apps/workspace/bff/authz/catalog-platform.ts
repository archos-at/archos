/**
 * The platform tier of the authorization catalog (`./catalog.ts`, ADR-0038),
 * split off to keep that file within its size limit. Pure data, like it.
 */

import type { PermissionSpec } from './catalog'

/**
 * Platform-tier permissions. Only ever attached to `platform-org` roles.
 *
 * **This separation is enforced by US, not by WorkOS.** Verified against the
 * live API on 2026-07-31: a role whose resource type is `organization` was
 * created holding `project:view`, a Project-tier permission, and WorkOS accepted
 * it — permissions are NOT constrained to roles of their own resource type.
 * Moving `platform:*` onto a dedicated resource type would therefore buy tidier
 * grouping and no security guarantee at all.
 *
 * What actually holds the line is two things, both ours:
 *   1. `./platform` requires membership of the GRID Platform organization
 *      before any platform surface answers — a claim alone is never enough.
 *   2. `catalog.spec.ts` asserts no environment-scoped role holds a
 *      `platform:*` permission, which is the ONLY check standing between a
 *      careless provisioning edit and a tenant role carrying platform access.
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
  {
    slug: 'platform:knowledge:approve_as_domain_expert',
    name: 'Approve knowledge as domain expert',
    description:
      'Platform tier: approve a platform knowledge change request in the domain expert role. Never for a request the approver wrote in.',
    tier: 'platform',
  },
  {
    slug: 'platform:knowledge:approve_as_counsel',
    name: 'Approve knowledge as counsel',
    description: 'Platform tier: approve a platform knowledge change request in the counsel role.',
    tier: 'platform',
  },
  {
    slug: 'platform:knowledge:approve_as_second_reviewer',
    name: 'Approve knowledge as second reviewer',
    description: 'Platform tier: approve a platform knowledge change request in the second reviewer role.',
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
