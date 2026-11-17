/**
 * The guard on the guard.
 *
 * `grid/require-tenant-cache-key` has the two failure modes every allowlisted
 * rule has, and both are silent. Too permissive and the tenant leak it exists to
 * stop walks back in wearing a key-builder; too strict and the next author
 * reaches for `eslint-disable`, which is worse than not having the rule at all
 * because it looks like the rule ran.
 *
 * So the valid cases below are every key SHAPE that is actually in `lib/` today
 * — inline template, builder function, local const, nullish default — and the
 * invalid ones are the shapes a leak arrives in.
 */

import { RuleTester } from 'oxlint/plugins-dev'
import { describe, expect, it } from 'vitest'
import rule from './require-tenant-cache-key.mjs'
import { GLOBAL_CACHE_KEYS } from './global-cache-keys.mjs'

const ruleTester = new RuleTester({
  eslintCompat: true,
  languageOptions: { sourceType: 'module' },
})

const withImport = (body) => `import { getCached, setCached } from '@/lib/cache'\n${body}`

ruleTester.run('require-tenant-cache-key', rule, {
  valid: [
    withImport("getCached(`orgname:${organizationId}`, 1000, load)"),
    withImport("getCached(`membership-role:${organizationId}:${userId}`, 1000, load)"),
    withImport("getCached(`promptview:${organizationId ?? ANON}:${projectId}`, 1000, load)"),
    withImport("getCached(`websearch:${session.organizationId}`, 1000, load)"),
    withImport(
      'const orgNameCacheKey = (organizationId) => `orgname:${organizationId}`\n' +
        'getCached(orgNameCacheKey(id), 1000, load)',
    ),
    withImport(
      'function limitsCacheKey(organizationId, unit) {\n' +
        '  if (!unit) return `budgetlimits:${organizationId}:credit`\n' +
        '  return `budgetlimits:${organizationId}:${unit}`\n' +
        '}\n' +
        'getCached(limitsCacheKey(id, unit), 1000, load)',
    ),
    withImport(
      'const cacheKey = `orgmodelcatalog:${organizationId}:${credential.id}`\n' +
        'getCached(cacheKey, 1000, load)',
    ),
    withImport("getCached(`zdronly:${orgId}`, 1000, load)"),
    withImport("getCached('openrouter:catalog', 1000, load)"),
    withImport("const KEY = 'platformpricing:active'\ngetCached(KEY, 1000, load)"),
    withImport("setCached(`ratelimit:${organizationId}:${userId}`, 1, 1000)"),
    "import { invalidateCached, invalidateCachedPrefix } from '@/lib/cache'\n" +
      "invalidateCachedPrefix('budgetlimits:')\n" +
      'keys.map((key) => invalidateCached(key))',
    'function getCached(key, ttl, load) { return load() }\ngetCached(`digest:${projectId}`, 1000, load)',
    "import { getCached as readThrough } from '@/lib/cache'\n" +
      'readThrough(`orgname:${organizationId}`, 1000, load)',
  ],
  invalid: [
    {
      code: withImport('getCached(`promptview:${projectId}`, 1000, load)'),
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: withImport("getCached('platformlessons:summary', 1000, load)"),
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: withImport(
        'const digestKey = (windowDays, topic) => `feedback:digest:${windowDays}:${topic}`\n' +
          'getCached(digestKey(30, topic), 1000, load)',
      ),
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: withImport(
        'getCached(scoped ? `orgname:${organizationId}` : `orgname:global`, 1000, load)',
      ),
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: withImport('setCached(`directory:${userId}`, people, 1000)'),
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: withImport('export const read = (key) => getCached(key, 1000, load)'),
      errors: [{ messageId: 'unreadable' }],
    },
    {
      code:
        "import { getCached } from '@/lib/cache'\n" +
        "import { keyFor } from './keys'\n" +
        'getCached(keyFor(projectId), 1000, load)',
      errors: [{ messageId: 'unreadable' }],
    },
  ],
})

describe('the global-key allowlist', () => {
  it('gives every entry a reason', () => {
    for (const [key, reason] of Object.entries(GLOBAL_CACHE_KEYS)) {
      expect(reason, `${key} has no reason`).toBeTruthy()
      expect(reason.length, `${key}'s reason is too short to be one`).toBeGreaterThan(40)
    }
  })

  it('holds only constant keys — a key with a segment in it is not global', () => {
    for (const key of Object.keys(GLOBAL_CACHE_KEYS)) {
      expect(key, `${key} looks interpolated`).not.toMatch(/\$\{|\*/)
    }
  })
})
