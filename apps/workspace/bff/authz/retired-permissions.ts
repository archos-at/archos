/**
 * Permissions the catalog used to declare and no longer does.
 *
 * Taking a permission out of `./catalog` is half of removing it: every WorkOS
 * environment the old catalog reached still holds it. This list is the other
 * half. `scripts/provision-workos-authz.ts` reads it: under `--apply` (which
 * every deploy runs) a retired permission that still exists is taken off every
 * role holding it and deleted, and under `--check` it is drift until that has
 * happened. So a removal reaches each environment through the same reviewed
 * change that creates permissions, and nobody deletes anything in a dashboard.
 *
 * A slug in one of our namespaces that is in WorkOS, absent from the catalog
 * and absent from this list still fails the check: that is a half-removed
 * feature, or a permission somebody made by hand.
 *
 * To retire a permission: remove it from `./catalog` and add it here in the
 * same change, with the decision that retired it. An entry stays for good: a
 * retired slug that is gone everywhere costs one set lookup, and an environment
 * restored from an old state is cleaned again. A retired slug must never be
 * declared in the catalog again (`retired-permissions.spec.ts`): each deploy
 * would create it and then delete it.
 *
 * It lives beside the catalog, not in it, because `catalog.ts` is at its size
 * limit (`ci/size_baseline.json`).
 */
export interface RetiredPermission {
  slug: string
  /** The ADR, migration or pull request that retired it. */
  retiredBy: string
}

const retired = (retiredBy: string, slugs: readonly string[]): RetiredPermission[] =>
  slugs.map((slug) => ({ slug, retiredBy }))

export const RETIRED_PERMISSIONS: readonly RetiredPermission[] = [
  ...retired('ADR-0176 amendment, migration 0218, #1594: the second_reviewer role is gone', [
    'platform:knowledge:approve_as_second_reviewer',
  ]),
  // The two below were deleted by hand in Staging and Production
  // (`docs/deployment/workos-provisioning.md`). They are listed so any other
  // environment the old catalog reached is cleaned the same way. Their roles
  // (`workflow-*`) and resource types are not permissions: those stay a
  // dashboard step.
  ...retired('ADR-0023 superseded by Agent Skills (220c2e153)', [
    'workflow:view',
    'workflow:run',
    'workflow:manage',
    'project:workflows:manage',
  ]),
  ...retired("ADR-0038's amendment of 2026-10-27: no skill resource was ever created", [
    'skill:view',
    'skill:run',
    'skill:manage',
  ]),
]
