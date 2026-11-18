// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { calleeName, callsTo, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const SOURCES = productionSources()
const ROUTES = SOURCES.filter((file) => file.startsWith('app/api/') && file.endsWith('/route.ts'))

const SLOT_FACTORIES = new Set([
  'apiRoute',
  'internalApiRoute',
  'publicApiRoute',
  'platformApiRoute',
  'tenantSlotRoute',
  'mcpDoorPost',
])
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

function declaresSlotRoute(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => {
    const exported =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported || !ts.isVariableStatement(statement)) return false
    return statement.declarationList.declarations.some((declaration) => {
      const initializer = declaration.initializer
      return (
        ts.isIdentifier(declaration.name) &&
        HTTP_METHODS.has(declaration.name.text) &&
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        SLOT_FACTORIES.has(calleeName(initializer) ?? '')
      )
    })
  })
}

describe('tenant slot coverage', () => {
  it('every API route opens a slot, by factory or explicitly', () => {
    expect(ROUTES.length, 'the walk found no app/api route.ts files').toBeGreaterThan(0)

    const unscoped = ROUTES.filter((file) => !declaresSlotRoute(parseSource(file)))

    expect(
      unscoped,
      'These routes open no tenant slot, so they run on the unbounded enterWith ' +
        'fallback and can inherit the previous request\'s tenant. Declare them ' +
        'through a factory, or wrap them in tenantSlotRoute().'
    ).toEqual([])
  })

  it('nothing calls the unbounded enterWith except the session fallback', () => {
    const callers = SOURCES.flatMap((file) => callsTo(parseSource(file), 'enterWith').map(() => file))

    expect(
      callers,
      'Only the tenant-context session fallback may call the unbounded enterWith: a call anywhere ' +
        'else leaks a tenant to the next request on a keep-alive socket. Enter a scope through ' +
        'enterTenantContext() or a route factory.'
    ).toEqual(['bff/db/tenant-context.ts'])
  })
})
