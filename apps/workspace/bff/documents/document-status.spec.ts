// @disk-inputs: app/**, bff/**, i18n/**, migrations/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filesCopy } from '@/i18n/namespaces/files'
import { getByPath } from '@/i18n/translate'
import { lineOf, nodesOf, parseSource, ts, walk } from '@/test-utils/source-ast'
import { functionCalls, parseSql, readSql, type SqlStatement, type SqlToken } from '@/test-utils/sql-statements'
import { SOURCE_DIRS } from '@/test-utils/source-tree'
import {
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_FACTS,
  IN_FLIGHT_DOCUMENT_STATUSES,
  columnStatuses,
  documentStatusFacts,
  isDocumentStatus,
  isKnownDocumentStatus,
} from './document-status'
import { SURFACE_STATES, SURFACE_STATE_LABEL_KEYS, surfaceStateOf } from './surface-state'

const WRITER_DIRS = ['bff/documents', 'bff/session-documents', 'bff/office-shelf']

function filesUnder(dir: string, accept: (name: string) => boolean, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) filesUnder(path, accept, found)
    else if (accept(entry.name)) found.push(path)
  }
  return found
}

const isWriterSource = (name: string): boolean => name.endsWith('.ts') && !name.includes('.spec.')

const isAnySource = (name: string): boolean =>
  (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.spec.') && !name.includes('.test.')

interface LiteralWrite {
  value: string
  where: string
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

interface OpaqueWrite {
  expression: string
  where: string
}

const OPAQUE_STATUS_WRITES: Readonly<Record<string, string>> = {
  'bff/documents/repository/reconcile.ts: resolution.status':
    "whatever reconcile-status.ts resolved: 'completed' or 'failed'",
  'bff/documents/reingest.ts: settled.status': "a read of the row answered to the caller of the stop, not a write",
  'bff/documents/cancel-wire.ts: statusAfterStop': "the stop answer's wire schema field, not a write",
  'bff/documents/repository/list.ts: documents.status': 'a SELECT projection, not a write',
  'bff/documents/repository/lookup-by-ref.ts: documents.status': 'a SELECT projection, not a write',
  'bff/documents/repository/name-lookup.ts: documents.status': 'a SELECT projection, not a write',
  'bff/documents/repository/reconcile.ts: documents.status':
    'a RETURNING projection and a guard comparison, not a write',
  'bff/session-documents/repository.ts: documents.status': 'a SELECT projection, not a write',
  'bff/office-shelf/project-norms/repository.ts: documents.status': 'a SELECT projection, not a write',
  'bff/documents/name-probe-types.ts: z.string()':
    "the name probe's wire schema, carrying the status the probe read to the upload planner; never a write",
  'bff/documents/placement-repository.ts: documents.status':
    "a SELECT and RETURNING projection, not a write; its one write is the literal 'processing'",
  'bff/documents/reconcile-status.ts: response.status': 'an HTTP status code, not the column',
  'bff/documents/reconcile-status.ts: file.status':
    "the BACKEND's file state, compared against, never stored",
  'bff/documents/reconcile-status.ts: resolution.status':
    'the value this module just decided, on its way to the repository',
  'bff/documents/reconcile-status.ts: row.status':
    'the status the read saw, the guard of the repository write (`ReconciledFrom`), never written',
  'bff/documents/reingest.ts: doc.status': 'the row being read back, returned to the caller',
  'bff/documents/document-details.ts: reconciled.status': 'a reconciled status, returned to the caller',
  'bff/documents/reingest.ts: knowledge.resolution.status':
    'the healed resolution echoed in the 409, returned to the caller',
  'bff/documents/list-projection.ts: row.status': 'a row being serialized, not a write',
  'bff/documents/reingest.ts: failure.status': 'the refused row echoed in the 409, returned to the caller',
  'bff/documents/shelf-listing.ts: row.status': 'a row handed to the retry rule, not a write',
  'bff/documents/reingest.ts: status': "the dispatcher's job status, returned to the caller",
  'bff/session-documents/service.ts: status':
    "the dispatcher's job status, returned to the caller",
  'bff/documents/shelf-upload.ts: status': "the dispatcher's job status, returned to the caller",
}

function isStatusName(name: ts.Node): boolean {
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'status'
}

function isStatusTarget(target: ts.Expression): boolean {
  return (
    (ts.isPropertyAccessExpression(target) && target.name.text === 'status') ||
    (ts.isIdentifier(target) && target.text === 'status')
  )
}

function literalValues(node: ts.Expression): string[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isNumericLiteral(node)) return []
  if (ts.isParenthesizedExpression(node)) return literalValues(node.expression)
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalValues(node.expression)
  if (ts.isConditionalExpression(node)) {
    const whenTrue = literalValues(node.whenTrue)
    const whenFalse = literalValues(node.whenFalse)
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const left = literalValues(node.left)
    const right = literalValues(node.right)
    return left && right ? [...left, ...right] : null
  }
  return null
}

function literalTypes(node: ts.TypeNode): string[] {
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return [node.literal.text]
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(literalTypes)
  if (ts.isParenthesizedTypeNode(node)) return literalTypes(node.type)
  return []
}

type TextNode = ts.StringLiteralLike | ts.TemplateExpression

const isTextNode = (node: ts.Node): node is TextNode => ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)

function textOf(node: TextNode): string {
  return ts.isTemplateExpression(node)
    ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ')
    : node.text
}

function isWord(token: SqlToken | undefined, word: string): boolean {
  return (token?.kind === 'word' || token?.kind === 'quoted') && token.text.toLowerCase() === word.toLowerCase()
}

function sqlStatusValues(sql: string): string[] {
  return parseSql(sql).flatMap(({ tokens }) =>
    tokens.flatMap((token, i) => {
      const equals = tokens[i + 1]
      const value = tokens[i + 2]
      if (!isWord(token, 'status') || equals?.kind !== 'symbol' || equals.text !== '=') return []
      return value?.kind === 'string' || value?.kind === 'quoted' ? [value.text] : []
    }),
  )
}

interface Scan {
  literals: LiteralWrite[]
  opaque: OpaqueWrite[]
}

function scanWriters(): Scan {
  const literals: LiteralWrite[] = []
  const opaque: OpaqueWrite[] = []

  for (const dir of WRITER_DIRS) {
    for (const file of filesUnder(join(process.cwd(), dir), isWriterSource)) {
      const source = parseSource(file)
      const relativePath = toPosix(relative(process.cwd(), file))
      const at = (node: ts.Node) => `${relativePath}:${lineOf(node)}`

      const record = (node: ts.Node, value: ts.Expression) => {
        const values = literalValues(value)
        if (values === null) opaque.push({ expression: value.getText(source), where: at(node) })
        else for (const found of values) literals.push({ value: found, where: at(node) })
      }

      walk(source, (node) => {
        if (ts.isPropertyAssignment(node) && isStatusName(node.name)) record(node, node.initializer)
        else if (ts.isShorthandPropertyAssignment(node) && isStatusName(node.name)) {
          opaque.push({ expression: node.name.text, where: at(node) })
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isStatusTarget(node.left)) {
          record(node, node.right)
        } else if (ts.isPropertySignature(node) && isStatusName(node.name) && node.type) {
          for (const value of literalTypes(node.type)) literals.push({ value, where: at(node) })
        } else if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'sql') {
          for (const value of sqlStatusValues(textOf(node.template))) literals.push({ value, where: at(node) })
        }
      })
    }
  }

  return { literals, opaque }
}

describe('every status a writer emits is declared', () => {
  const { literals, opaque } = scanWriters()

  it('finds the writers at all', () => {
    const found = new Set(literals.map((write) => write.value))
    expect([...found].sort()).toContain('pending')
    expect([...found].sort()).toContain('completed')
    expect([...found].sort()).toContain('stored')
  })

  it('declares every one of them', () => {
    const undeclared = [...new Set(literals.filter((write) => !isKnownDocumentStatus(write.value)))]
      .map((write) => `${write.value}  (${write.where})`)
      .sort()
    expect(
      undeclared,
      'These statuses are written to documents.status but are not declared in ' +
        'bff/documents/document-status.ts, so the badge renders them grey ' +
        'and the poller ignores them. Add an entry with its variant and phase.',
    ).toEqual([])
  })

  it('writes only what the column may hold', () => {
    const refused = [...new Set(literals.filter((write) => !isDocumentStatus(write.value)))]
      .map((write) => `${write.value}  (${write.where})`)
      .sort()
    expect(refused, 'documents.status allows only DOCUMENT_STATUSES (CHECK documents_status_known).').toEqual([])
  })

  it('names every write it could not read', () => {
    const unexplained = [...new Set(opaque.map((write) => `${write.where.split(':')[0]}: ${write.expression}`))]
      .filter((key) => !(key in OPAQUE_STATUS_WRITES))
      .sort()
    expect(
      unexplained,
      'These sites write documents.status from an expression this scan cannot ' +
        'read, so no guard can tell you what value they produce. Either write a ' +
        'literal, or add the site to OPAQUE_STATUS_WRITES saying what it can ' +
        'put in the column.',
    ).toEqual([])
  })

  it('keeps the list of unreadable writes from growing quietly', () => {
    const present = new Set(opaque.map((write) => `${write.where.split(':')[0]}: ${write.expression}`))
    const stale = Object.keys(OPAQUE_STATUS_WRITES).filter((key) => !present.has(key)).sort()
    expect(stale, 'These OPAQUE_STATUS_WRITES entries match nothing any more.').toEqual([])
  })
})

const PASS_THROUGH_TABLE_WRITERS = [
  'bff/storage/repository.ts',
  'bff/projects/folder-bin-repository.ts',
  'bff/projects/folder-derived-repository.ts',
]

function isDocumentsArgument(call: ts.CallExpression): boolean {
  const [only] = call.arguments
  return call.arguments.length === 1 && !!only && ts.isIdentifier(only) && only.text === 'documents'
}

function writesDocumentsSql(sql: string): boolean {
  return parseSql(sql).some(({ tokens }) =>
    tokens.some((token, i) => isWord(token, 'update') && isWord(tokens[i + 1], 'documents') && isWord(tokens[i + 2], 'set')),
  )
}

function writesDocumentsTable(source: ts.SourceFile): boolean {
  const byCall = nodesOf(source, ts.isCallExpression).some(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) &&
      ['insert', 'update'].includes(call.expression.name.text) &&
      isDocumentsArgument(call),
  )
  return byCall || nodesOf(source, isTextNode).some((node) => writesDocumentsSql(textOf(node)))
}

function tableWriterFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) => filesUnder(join(process.cwd(), dir), isAnySource))
    .filter((file) => writesDocumentsTable(parseSource(file)))
    .map((file) => toPosix(relative(process.cwd(), file)))
    .sort()
}

describe('the scan looks where the writing happens', () => {
  const tableWriters = tableWriterFiles()

  it('finds the table writers at all', () => {
    expect(tableWriters.some((file) => file.startsWith('bff/documents/repository/'))).toBe(true)
  })

  it('has no writer of the documents table outside the scanned directories', () => {
    const unscanned = tableWriters.filter(
      (file) =>
        !WRITER_DIRS.some((dir) => file.startsWith(`${dir}/`)) &&
        !PASS_THROUGH_TABLE_WRITERS.includes(file),
    )
    expect(
      unscanned,
      'These modules write the documents table but sit outside WRITER_DIRS, so ' +
        'any status they author is invisible to this guard. Add the directory ' +
        'to WRITER_DIRS, or list the file in PASS_THROUGH_TABLE_WRITERS if it ' +
        'only writes rows its callers built.',
    ).toEqual([])
  })
})

describe('stored is terminal and neutral', () => {
  it('is never polled', () => {
    expect(IN_FLIGHT_DOCUMENT_STATUSES.has('stored')).toBe(false)
    expect(DOCUMENT_STATUS_FACTS.stored.phase).toBe('terminal')
  })

  it('is neither a success nor a failure', () => {
    expect(DOCUMENT_STATUS_FACTS.stored.variant).toBe('secondary')
  })

  it('leaves the states that ARE in flight alone', () => {
    expect([...IN_FLIGHT_DOCUMENT_STATUSES].sort()).toEqual([
      'ingesting',
      'pending',
      'processing',
      'uploading',
    ])
  })
})

describe('uploaded is terminal and neutral', () => {
  it('never promised quotability', () => {
    expect(DOCUMENT_STATUS_FACTS.uploaded.variant).toBe('secondary')
    expect(DOCUMENT_STATUS_FACTS.uploaded.phase).toBe('terminal')
    expect(surfaceStateOf('uploaded')).toBe('stored')
    expect(IN_FLIGHT_DOCUMENT_STATUSES.has('uploaded')).toBe(false)
  })
})

describe('the declaration answers about values, not about prototypes', () => {
  it('does not mistake an Object.prototype key for a status', () => {
    expect(documentStatusFacts('constructor')).toBeNull()
    expect(documentStatusFacts('toString')).toBeNull()
  })

  it('reads a status the way the column writes it', () => {
    expect(documentStatusFacts('READY')).toEqual(DOCUMENT_STATUS_FACTS.ready)
    expect(documentStatusFacts(null)).toBeNull()
    expect(documentStatusFacts('')).toBeNull()
  })
})

describe('every surface state has a label in both locales', () => {
  it.each(SURFACE_STATES)('%s', (state) => {
    const key = SURFACE_STATE_LABEL_KEYS[state]
    expect(typeof getByPath(filesCopy.messages.en, key), `filesCopy.messages.en.${key}`).toBe('string')
    expect(typeof getByPath(filesCopy.messages.de, key), `filesCopy.messages.de.${key}`).toBe('string')
  })
})

const STATUS_CONSTRAINT = 'documents_status_known'

function addsStatusConstraint(statements: SqlStatement[]): boolean {
  return statements.some(({ tokens }) =>
    tokens.some(
      (token, i) =>
        token.kind === 'quoted' &&
        token.text === STATUS_CONSTRAINT &&
        isWord(tokens[i - 1], 'constraint') &&
        isWord(tokens[i - 2], 'add'),
    ),
  )
}

describe('the column vocabulary (migration 0135, extended by 0153)', () => {
  it('renders every value the column may hold', () => {
    for (const status of DOCUMENT_STATUSES) expect(isKnownDocumentStatus(status), status).toBe(true)
  })

  it('is the set the CHECK lists, in the migration and in the schema', () => {
    const dir = join(process.cwd(), 'migrations')
    const defining = readdirSync(dir)
      .filter((name) => name.endsWith('.sql') && !name.endsWith('.down.sql'))
      .sort()
      .filter((name) => addsStatusConstraint(readSql(join(dir, name))))
    expect(defining, 'a migration must define documents_status_known').not.toEqual([])
    const latest = defining[defining.length - 1]
    const listed = functionCalls(readSql(join(dir, latest)), 'CHECK')
      .find((args) => args[0]?.kind === 'quoted' && args[0].text === 'status')
      ?.filter((token) => token.kind === 'string')
      .map((token) => token.text)
    expect(listed, `the CHECK in ${latest}`).toBeDefined()
    expect([...(listed ?? [])].sort()).toEqual([...DOCUMENT_STATUSES].sort())
  })

  it('narrows an outside set to the column, for a SQL filter', () => {
    expect(columnStatuses(IN_FLIGHT_DOCUMENT_STATUSES).sort()).toEqual(['pending', 'processing'])
    expect(columnStatuses(['completed', 'ready', 'success'])).toEqual(['completed'])
  })
})
