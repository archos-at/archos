/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { calleeName, nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const DELEGATING_GUARDS: readonly string[] = [
  'requireFeature',
  'requireCollaborationEnabled',
  'requireSkillsEnabled',
  'requireTaskAutomationEnabled',
]

const NOT_A_REFUSAL: Record<string, string> = {
  'app/api/internal/stages/route.ts': 'reports each switch to the agent tier as a boolean; it refuses nothing',
  'app/api/organization/web-search/route.ts': 'writes the office’s own setting; the switch is read by the turn, not here',
}

const isRoute = (file: string): boolean => /^app\/api\/(.+\/)?route\.ts$/.test(file)

const readsSwitch = (source: ts.SourceFile): boolean =>
  nodesOf(source, ts.isPropertyAccessExpression).some(
    (access) => ts.isIdentifier(access.expression) && access.expression.text === 'FEATURE_FLAGS',
  ) || nodesOf(source, ts.isCallExpression).some((call) => calleeName(call) === 'isFeatureEnabled')

const refusesThroughGuard = (source: ts.SourceFile): boolean =>
  nodesOf(source, ts.isCallExpression).some((call) => DELEGATING_GUARDS.includes(calleeName(call) ?? ''))

const isBareEnvelope = (node: ts.Node): boolean =>
  ts.isPropertyAssignment(node) &&
  (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
  node.name.text === 'error' &&
  ts.isStringLiteral(node.initializer) &&
  node.initializer.text === 'feature-disabled'

describe('a switched-off feature refuses one way (RFC 9457 feature_disabled)', () => {
  it('every route that reads a switch refuses through requireFeature', () => {
    const routes = productionSources().filter(isRoute).map((file) => ({ file, source: parseSource(file) }))
    const reading = routes.filter(({ source }) => readsSwitch(source))
    const unguarded = reading
      .filter(({ file, source }) => !refusesThroughGuard(source) && !NOT_A_REFUSAL[file])
      .map(({ file }) => file)
    expect(unguarded).toEqual([])
    expect(reading.length).toBeGreaterThan(5)
  })

  it('no source emits the old bare envelope', () => {
    const sources = productionSources().filter((file) => /^(app|bff)\//.test(file))
    const bare = sources.filter((file) => nodesOf(parseSource(file), isBareEnvelope).length > 0)
    expect(bare).toEqual([])
  })
})
