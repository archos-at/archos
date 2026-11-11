// @disk-inputs: app/**, bff/**, purger/**, shared/**, ui/**, utils/**, workers/**
/**
 * Who may set `documents.status` is a list somebody reads, not something a new
 * writer joins unseen. Costed on 2026-11-11 against one settle function for
 * every writer and found the smaller thing that holds: the guards are of four
 * kinds and do not fit one signature, and a job's outcome already has one way
 * in. So the ways in are counted here, each with the guard its `WHERE` carries,
 * and with why that guard is not the declared lifecycle's list where it is not
 * (`./reading-lifecycle`). Parsed with the TypeScript compiler, like
 * `document-visibility.spec.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'

/** Every function that sets the column, keyed `<path>#<function>`: what it writes, and the guard in its `WHERE`. */
const STATUS_WRITERS: Record<string, string> = {
  'bff/documents/repository/reconcile.ts#setDocumentReconciledStatus':
    "A job's outcome, mirrored from the backend. Not the lifecycle: a compare-and-set on the status the read saw and the ingest job id, which tells a late report from a true one; a list of states cannot.",
  'bff/documents/repository/ingest-state.ts#markDocumentIngestFailed':
    "`failed`, on the BFF's own word. With an owner, not the lifecycle: `stillOwnedBy` (still `processing`, same bytes, same job), so work that lost the row fails nothing. Without one, the lifecycle: `statusAccepts('fail')`.",
  'bff/documents/repository/mutations.ts#setDocumentIngestJob':
    "`pending` with the new job id, on the backend's 202. The lifecycle: `statusAccepts('dispatch')`.",
  'bff/documents/repository/mutations.ts#markDocumentProcessing':
    "`processing`, for work the BFF runs itself. The lifecycle: `statusAccepts('process')`.",
  'bff/documents/repository/mutations.ts#markDocumentNotIndexed':
    "`stored`: the bytes stay and nothing reads them. The lifecycle: `statusAccepts('unindex')`.",
  'bff/documents/repository/reconcile.ts#markScreeningReleased':
    "`uploaded`, a reviewer's release. Not the lifecycle: `heldAtRest()` and the content hash the reviewer saw, because the hold is a verdict column and not a status.",
  'bff/documents/repository/quarantine-and-retry.ts#markForRescreening':
    '`uploaded`, a reviewer asks the gate again. Not the lifecycle: `heldAtRest()` and the content hash, as the release.',
  'bff/storage/repository.ts#replaceDocumentWithinQuota':
    '`uploaded`, new bytes. Not the lifecycle: id and organization only; `assertMayReplaceHeld` upstream and the quarantine trigger (migrations 0122, 0225) refuse a held row.',
  'bff/storage/repository.ts#insertDocumentWithinQuota':
    'The birth of a row, in the status its caller gives it (`uploaded`, or `stored` for a document the agent wrote). No `WHERE`: there is no earlier state.',
  'bff/projects/folder-bin-repository.ts#markDocumentsRestoring':
    "`processing` with the restore job's id, for a folder back from the Papierkorb. The lifecycle: `statusesAccepting('process')`.",
  'bff/documents/placement-repository.ts#repointPlacementRow':
    '`processing`, when a placement needs the file read again. Not the lifecycle: a compare-and-set on the collection name; its caller leaves a quarantined row out before it asks.',
}

/** Every file that names the one function writing a job's outcome. A third caller is a second way in. */
const MAY_WRITE_A_JOB_OUTCOME: Record<string, string> = {
  'bff/documents/repository/reconcile.ts': 'Defines it.',
  'bff/documents/repository.ts': "The repository's index re-exports it.",
  'bff/documents/reconcile-status.ts':
    'The reconcile: every read, both sweeps and the settle push arrive here, and its four passes write what the backend said.',
  'bff/documents/reingest.ts':
    "A person's re-read and stop: each has just asked the backend about this one row, writes that answer under the same compare-and-set, and runs `onDocumentsSettled` itself.",
}

const ROOTS = ['app', 'bff', 'ui', 'shared', 'utils', 'workers', 'purger']
const SOURCE = /\.(tsx?|m?js)$/
const SPEC = /\.(spec|test)\.[a-z]+$/
/** Raw SQL that updates the table and names the column before any `WHERE`. */
const RAW_STATUS_UPDATE = /\bupdate\s+(?:(?:"?public"?\.)?"?documents"?|\$\{documents\})\s(?:(?!\bwhere\b)[^;`])*\bset\b(?:(?!\bwhere\b)[^;`])*\bstatus"?\s*=/i

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, found)
    } else if (SOURCE.test(entry.name) && !SPEC.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

function enclosingFunction(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText()
    const owner = current.parent
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && owner && ts.isVariableDeclaration(owner)) {
      return owner.name.getText()
    }
  }
  return '<module>'
}

const isTable = (node: ts.Node | undefined) => !!node && /^(schema\.)?documents$/.test(node.getText())
const calls = (node: ts.Node, method: string): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === method

/** Whether `.set(values)` can name `status`: in the literal, or in a local the literal spreads. Anything else counts. */
function setsStatus(values: ts.Node, tree: ts.SourceFile): boolean {
  if (!ts.isObjectLiteralExpression(values)) return true
  const locals = new Set<string>()
  let found = false
  const walk = (node: ts.Node) => {
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getText() === 'status') found = true
    if (ts.isSpreadAssignment(node) && ts.isIdentifier(node.expression)) locals.add(node.expression.text)
    ts.forEachChild(node, walk)
  }
  walk(values)
  const declared = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && locals.has(node.name.getText()) && node.initializer) walk(node.initializer)
    ts.forEachChild(node, declared)
  }
  declared(tree)
  return found
}

function scan(source: string, path: string): { writers: string[]; namesOutcomeWriter: boolean } {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const writers = new Set<string>()
  let namesOutcomeWriter = false
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'setDocumentReconciledStatus') namesOutcomeWriter = true
    const target = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined
    const update = calls(node, 'set') && target && calls(target, 'update') && isTable(target.arguments[0])
    if (calls(node, 'insert') && isTable(node.arguments[0])) writers.add(`${path}#${enclosingFunction(node)}`)
    if (update && setsStatus(node.arguments[0], tree)) writers.add(`${path}#${enclosingFunction(node)}`)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { writers: [...writers], namesOutcomeWriter }
}

describe('who may set documents.status', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root))).map((file) => {
    const path = relative(process.cwd(), file).replace(/\\/g, '/')
    const source = readFileSync(file, 'utf8')
    return { path, source, ...scan(source, path) }
  })

  it('is the listed functions and no other', () => {
    expect(
      files.flatMap((file) => file.writers).sort(),
      'A function that sets `documents.status` and is not in STATUS_WRITERS, or an entry whose function is gone. ' +
        "A job's outcome goes through `setDocumentReconciledStatus`; a new writer says here what guards its WHERE, " +
        'and why that is not the list `./reading-lifecycle` declares if it is not.'
    ).toEqual(Object.keys(STATUS_WRITERS).sort())
  })

  it("lets only the reconcile and a person's re-read or stop write a job's outcome", () => {
    expect(
      files.filter((file) => file.namesOutcomeWriter).map((file) => file.path).sort(),
      '`setDocumentReconciledStatus` named in a file MAY_WRITE_A_JOB_OUTCOME does not list. A path that learns a ' +
        "job's outcome calls `reconcileDocumentStatuses`, which also runs what follows a settled document."
    ).toEqual(Object.keys(MAY_WRITE_A_JOB_OUTCOME).sort())
  })

  it('never sets the column in raw SQL', () => {
    expect(files.filter((file) => RAW_STATUS_UPDATE.test(file.source)).map((file) => file.path)).toEqual([])
  })

  it('finds what it guards (the scan is not vacuous)', () => {
    expect(scan('const f = () => db.update(documents).set({ ...patch })\nconst patch = { status: 1 }', 'p.ts').writers).toEqual(['p.ts#f'])
    expect(scan('function g(values) { return tx.update(schema.documents).set(values) }', 'p.ts').writers).toEqual(['p.ts#g'])
    expect(scan('function h() { return db.update(documents).set({ folderId }).where(eq(documents.status, x)) }', 'p.ts').writers).toEqual([])
    expect(RAW_STATUS_UPDATE.test("sql`UPDATE documents SET error_message = null, status = 'failed' WHERE id = ${id}`")).toBe(true)
    expect(RAW_STATUS_UPDATE.test("sql`UPDATE documents SET folder_id = null WHERE status = 'failed'`")).toBe(false)
  })
})
