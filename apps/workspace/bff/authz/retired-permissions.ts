export interface RetiredPermission {
  slug: string
  retiredBy: string
}

const retired = (retiredBy: string, slugs: readonly string[]): RetiredPermission[] =>
  slugs.map((slug) => ({ slug, retiredBy }))

export const RETIRED_PERMISSIONS: readonly RetiredPermission[] = [
  ...retired('ADR-0176 amendment, migration 0218, #1594: the second_reviewer role is gone', [
    'platform:knowledge:approve_as_second_reviewer',
  ]),
  ...retired('ADR-0023 superseded by Agent Skills (220c2e153)', [
    'workflow:view',
    'workflow:run',
    'workflow:manage',
    'project:workflows:manage',
  ]),
  ...retired('ADR-0024 office shelf rename, runbook step 3: every role holding it also holds org:office_shelf:manage', [
    'org:archiv:manage',
  ]),
  ...retired("ADR-0038's amendment of 2026-10-27: no skill resource was ever created", [
    'skill:view',
    'skill:run',
    'skill:manage',
  ]),
]
