// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { callsTo, importsOf, nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const ADMISSION = 'bff/storage/admission.ts'
const SERVICE = 'bff/storage/service.ts'
const ADMITTING_PATH = '@/lib/storage/admission'

const modules = productionSources()
  .filter((path) => !path.startsWith('app/dev/'))
  .map((path) => ({ path, source: parseSource(path) }))

const mentions = (node: ts.Node, name: string): boolean =>
  nodesOf(node, ts.isIdentifier).some((identifier) => identifier.text === name)

const takesIdentifier = (call: ts.CallExpression, name: string): boolean => {
  const [only] = call.arguments
  return call.arguments.length === 1 && ts.isIdentifier(only) && only.text === name
}

const importersOf = (specifier: string): string[] =>
  modules
    .filter(({ source }) => importsOf(source).some((edge) => edge.specifier === specifier))
    .map(({ path }) => path)

const chainedBeforeWhere = (call: ts.Expression): ts.CallExpression[] => {
  const member = call.parent
  if (!ts.isPropertyAccessExpression(member) || member.expression !== call) return []
  const next = member.parent
  if (!ts.isCallExpression(next) || next.expression !== member || member.name.text === 'where') return []
  return [next, ...chainedBeforeWhere(next)]
}

describe('every path that can create a machine-authored row', () => {
  it('inserts a documents row in exactly one module', () => {
    const inserters = modules
      .filter(({ source }) => callsTo(source, 'insert').some((call) => takesIdentifier(call, 'documents')))
      .map(({ path }) => path)
    expect(inserters).toEqual(['bff/storage/repository.ts'])
  })

  it('names the admitting function only in the admission path', () => {
    const direct = modules
      .filter(({ path }) => path !== ADMISSION && path !== SERVICE)
      .filter(({ source }) =>
        nodesOf(source, ts.isIdentifier).some((identifier) => identifier.text === 'admitDocumentWithinQuota'),
      )
      .map(({ path }) => path)
    expect(direct).toEqual([])
  })

  it('has exactly three callers of the admitting path, and only this one authors a row', () => {
    const admitters = importersOf(ADMITTING_PATH)
    expect(admitters).toEqual([
      'bff/documents/generated.ts',
      'bff/documents/shelf-upload.ts',
      'bff/session-documents/service.ts',
    ])

    const authoring = modules
      .filter(({ path, source }) =>
        admitters.includes(path) &&
        callsTo(source, 'admitOrDiscard').some((call) => mentions(call, 'authoredBy')),
      )
      .map(({ path }) => path)
    expect(authoring).toEqual(['bff/documents/generated.ts'])
  })

  it('never lets an UPDATE change the author of a row that already exists', () => {
    const promoting = modules
      .filter(({ source }) =>
        callsTo(source, 'update')
          .filter((call) => takesIdentifier(call, 'documents'))
          .some((call) => chainedBeforeWhere(call).some((chained) => mentions(chained, 'authoredBy'))),
      )
      .map(({ path }) => path)
    expect(promoting).toEqual([])
  })
})
