/**
 * @vitest-environment node
 */

/**
 * A switched-off feature refuses in one way, the RFC 9457 problem of
 * `requireFeature` (`feature_disabled`, `feature-flags.spec.ts` holds its shape
 * for every switch). Staging QC found three shapes for one meaning: the bare
 * `{error: 'feature-disabled'}`, prose 403s and a 200 `{enabled: false}`. This
 * holds the routes to the one: a route that reads a switch refuses through
 * `requireFeature` or a `require…Enabled` guard that delegates to it, and no
 * source words the refusal itself.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(ROOT, dir, name)
    if (statSync(path).isDirectory()) return files(relative(ROOT, path), keep)
    return keep(name) ? [relative(ROOT, path)] : []
  })
}

/** Guards that refuse through `requireFeature` (each is one line in `feature-flags.ts`). */
const DELEGATING_GUARDS = /\brequire(Feature|CollaborationEnabled|SkillsEnabled|TaskAutomationEnabled)\(/

/**
 * Reads of a switch that are not a refusal, each with why: a route that only
 * reports a switch, or one that hides a capability as not found by design.
 */
const NOT_A_REFUSAL: Record<string, string> = {
  'app/api/internal/stages/route.ts': 'reports each switch to the agent tier as a boolean; it refuses nothing',
  'app/api/organization/web-search/route.ts': 'writes the office’s own setting; the switch is read by the turn, not here',
}

describe('a switched-off feature refuses one way (RFC 9457 feature_disabled)', () => {
  it('every route that reads a switch refuses through requireFeature', () => {
    const routes = files('app/api', (name) => name === 'route.ts')
    const reading = routes.filter((file) => /FEATURE_FLAGS\.|isFeatureEnabled\(/.test(readFileSync(join(ROOT, file), 'utf8')))
    const unguarded = reading.filter((file) => !DELEGATING_GUARDS.test(readFileSync(join(ROOT, file), 'utf8')) && !NOT_A_REFUSAL[file])
    expect(unguarded).toEqual([])
    expect(reading.length).toBeGreaterThan(5)
  })

  it('no source words the refusal as the old bare envelope', () => {
    const sources = [...files('app', (n) => /\.tsx?$/.test(n)), ...files('bff', (n) => /\.tsx?$/.test(n))].filter(
      (file) => !/\.(spec|test)\.tsx?$/.test(file),
    )
    const bare = sources.filter((file) => /error: 'feature-disabled'/.test(readFileSync(join(ROOT, file), 'utf8')))
    expect(bare).toEqual([])
  })
})
