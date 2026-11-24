// @disk-inputs: app/**, bff/**, shared/**, ui/**
/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseSource, productionSources, ts } from '@/test-utils/source-ast'

const OWNERS: Record<string, readonly string[]> = {
  'bff/best-effort.ts': ['bestEffort', 'bestEffortInBackground'],
  'bff/inbox/best-effort.ts': ['bestEffortInbox'],
}

const BEST_EFFORT = /best_?effort/i

function declaredNames(source: ts.SourceFile): string[] {
  const names: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      names.push(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names.filter((name) => BEST_EFFORT.test(name))
}

describe('best-effort work', () => {
  it('goes through the shared helpers, which never swallow a missing tenant slot', () => {
    const copies = productionSources().flatMap((file) =>
      declaredNames(parseSource(file))
        .filter((name) => !OWNERS[file]?.includes(name))
        .map((name) => `${file}: ${name}`)
    )
    expect(
      copies,
      'A private best-effort wrapper swallows MissingTenantContextError with the rest, so work that ran ' +
        'outside a tenant slot shows only as a warning (b24884d7e). Use bestEffort or ' +
        'bestEffortInBackground from @/lib/best-effort.'
    ).toEqual([])
  })

  it('still finds the owners it allows', () => {
    const found = Object.fromEntries(Object.keys(OWNERS).map((file) => [file, declaredNames(parseSource(file))]))
    expect(found).toEqual(OWNERS)
  })
})
