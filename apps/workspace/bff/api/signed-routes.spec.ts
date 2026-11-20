// @disk-inputs: app/api/**
/**
 * @vitest-environment node
 *
 * Signed internal routes and the proxy exclusion are one decision, held from
 * both sides.
 *
 * `proxy.ts` leaves `/api/internal/signed/` off its matcher so a raw body
 * reaches the route unbuffered: behind the proxy, a body above
 * `proxyClientMaxBodySize` is cut short without an error. So a route guarded by
 * a signature must live under that folder, and a route in that folder must be
 * guarded by a signature, because nothing else stands in front of it (no
 * AuthKit, no session). The factory also refuses a misplaced signed route at
 * run time (`assertSignedPath`); this catches it before anyone calls it.
 */
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callsTo, parseSource, parseSourceText, productionSources, ts } from '@/test-utils/source-ast'
import { SIGNED_INTERNAL_PREFIX } from './handler'

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../..')
const API_PREFIX = 'app/api/'
const SIGNED_FOLDER = SIGNED_INTERNAL_PREFIX.slice('/api/'.length)

function propertyNamed(object: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find(
    (property) =>
      !ts.isSpreadAssignment(property) &&
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === key
  )
}

function declaresSignature(source: ts.SourceFile): boolean {
  return callsTo(source, 'internalApiRoute').some((call) =>
    call.arguments.some((argument) => {
      if (!ts.isObjectLiteralExpression(argument)) return false
      const auth = propertyNamed(argument, 'auth')
      if (!auth || !ts.isPropertyAssignment(auth) || !ts.isObjectLiteralExpression(auth.initializer)) return false
      return propertyNamed(auth.initializer, 'signature') !== undefined
    })
  )
}

function placementProblems(file: string, source: ts.SourceFile): string[] {
  const inSignedFolder = file.startsWith(SIGNED_FOLDER)
  const signed = declaresSignature(source)
  if (signed && !inSignedFolder) return [`${file}: a signed route outside ${SIGNED_INTERNAL_PREFIX} sits behind the proxy`]
  if (inSignedFolder && !signed) return [`${file}: a route under ${SIGNED_INTERNAL_PREFIX} skips the proxy and must verify a signature`]
  return []
}

const ROUTES = productionSources(WORKSPACE)
  .filter((file) => file.startsWith(API_PREFIX) && file.endsWith('/route.ts'))
  .map((file) => ({
    file: file.slice(API_PREFIX.length),
    source: parseSource(file, WORKSPACE),
  }))

describe('signed internal routes', () => {
  it('finds the route surface (a broken walk would pass vacuously)', () => {
    expect(ROUTES.length).toBeGreaterThan(100)
  })

  it('live exactly under the folder the proxy skips', () => {
    expect(ROUTES.flatMap(({ file, source }) => placementProblems(file, source))).toEqual([])
  })

  it('catch both misplacements (the check above is not vacuous)', () => {
    const signed = parseSourceText(
      `export const POST = internalApiRoute('x', run, { auth: { signature: { keysEnv: 'K' } }, tenancy })`,
      'route.ts'
    )
    const token = parseSourceText(`export const POST = internalApiRoute('x', run, { tenancy })`, 'route.ts')

    expect(placementProblems('internal/memory/route.ts', signed)).toHaveLength(1)
    expect(placementProblems(`${SIGNED_FOLDER}inbound-mail/route.ts`, token)).toHaveLength(1)
    expect(placementProblems(`${SIGNED_FOLDER}inbound-mail/route.ts`, signed)).toEqual([])
    expect(placementProblems('internal/memory/route.ts', token)).toEqual([])
  })
})
