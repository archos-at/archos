import ts from 'typescript-api'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SOURCE_DIRS, srcKey, srcPath } from '@/test-utils/source-tree'
import type { DownloadLogKind } from './kinds'

type Disposition =
  | { logged: readonly DownloadLogKind[] }
  | {
      servesPerson?: true
      exempt: string
    }

export const OBJECT_READERS: Record<string, Disposition> = {
  'lib/documents/document-delivery.ts::getDocumentDownload': { logged: ['download'] },
  'lib/documents/document-delivery.ts::getDocumentPreview': { logged: ['preview'] },
  'lib/documents/document-delivery.ts::streamDocumentFile': { logged: ['pdf'] },
  'lib/documents/document-delivery.ts::getDocumentTextPreview': { logged: ['text'] },
  'lib/documents/version-content.ts::readVersionContent': { logged: ['version'] },
  'lib/documents/version-content.ts::streamVersionFile': { logged: ['version'] },
  'lib/bim/model-service.ts::getModelSource': { logged: ['model'] },
  'lib/documents/document-delivery.ts::getDocumentThumbnail': {
    servesPerson: true,
    exempt:
      'a derived 200 px JPEG of the first page, not the file. It does not hand over the document, and a thumbnail on every card would fill the log with who scrolled past what.',
  },
  'lib/documents/document-delivery.ts::streamDocumentImage': {
    servesPerson: true,
    exempt:
      'the Next image optimizer fetches it with no session, so there is no person to name. The signed URL it checks is minted by getDocumentPreview, which records the open (a download of the original goes through getDocumentDownload).',
  },
  'lib/documents/version-content.ts::readObjectText': {
    exempt:
      'a private helper; its callers are pinned in PINNED_HELPERS (the person-facing one records, the agent-facing one serves the agent).',
  },
  'lib/bim/internal-access.ts::getInternalModelSource': {
    exempt: 'presigns the IFC for the agent’s model tool inside a turn; no person receives the bytes.',
  },
  'lib/bim/service.ts::fetchObject': { exempt: 'server-side IFC extraction reads the file to build the model; nothing is handed to a person.' },
  'lib/documents/stored-copy.ts::storedFileOf': {
    exempt:
      'reads a project norm’s own bytes to file them into the office shelf, whose upload screens and stores them again; nobody receives them.',
  },
  'lib/documents/rendition.ts::readOriginal': { exempt: 'server-side conversion of an office file to its PDF rendition.' },
  'lib/documents/ingest-dispatch.ts::dispatchIngest': { exempt: 'presigns the file for the ingest backend, a machine.' },
  'lib/documents/extraction-jobs.ts::signedRenditionRef': { exempt: 'presigns the rendition for the ingest backend, a machine.' },
  'lib/storage/bucket.ts::readClaimOwner': { exempt: 'reads a bucket-claim marker object, not a document.' },
  'lib/mail-import/staging.ts::archiveUrlForBackend': {
    exempt:
      'presigns the person’s own staged .pst for the filing job to hand the backend, whose range reader opens it for libpff: a machine reading an upload in flight, not a document’s bytes. Nobody downloads it; the mails it files are documents, logged when a person opens them.',
  },
  'lib/inbound-mail/staging.ts::readStagedObject': {
    exempt:
      'reads a held mail’s staged objects (its raw message, `read.json`, an attachment) and a filed message’s original (ADR-0137): never a document. A person receives such bytes only through the held-attachment and the two original routes, each audited in its own trail (`inbound_mail.part_read`, `inbound_mail.original_read`, `mail_thread.original_read`), scanned before they leave; filed, an attachment is a document, logged when a person opens it.',
  },
  'lib/inbound-mail/staging.ts::streamStagedObject': {
    exempt: 'streams a staged mail object to the malware scanner, a machine (ADR-0157). Nobody receives the bytes.',
  },
  'lib/inbound-mail/staging.ts::stagedObjectUrlForBackend': {
    exempt: 'presigns the staged raw message for the Python mail reader, a machine (`POST /v1/mail/read`). Nobody downloads it.',
  },
  'lib/s3.ts::presignForBackend': {
    exempt:
      'signs, against the in-network endpoint, the command its caller built for the backend, a machine. A caller that reads builds the GetObjectCommand itself and is classified here in its own right.',
  },
}

function sourceFiles(dir?: string, found: string[] = []): string[] {
  if (!dir) return SOURCE_DIRS.flatMap((root) => sourceFiles(join(process.cwd(), root)))
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path === join(process.cwd(), 'app', 'dev')) continue
      sourceFiles(path, found)
    } else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test|fixtures)\.tsx?$/.test(entry.name)) {
      found.push(path)
    }
  }
  return found
}

export interface TopLevelFunction {
  key: string
  name: string
  file: string
  identifiers: Set<string>
  callsRecord: boolean
  recordedKinds: string[]
  buildsObjectRead: boolean
  calls: ResolvedCall[]
}

interface ResolvedCall {
  target: string
  conditional: boolean
  discarded: boolean
}

function topLevelFunctions(file: string): TopLevelFunction[] {
  const source = parsed(srcKey(file))
  return source ? functionsInSource(source) : []
}

function moduleFile(fromRel: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = specifier.slice(2)
  else if (specifier.startsWith('.')) base = join(fromRel, '..', specifier).replace(/\\/g, '/')
  else return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
  return candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(srcPath(candidate))) ?? `${base}.ts`
}

const parsedSources = new Map<string, ts.SourceFile | null>()
function parsed(rel: string): ts.SourceFile | null {
  if (!parsedSources.has(rel)) {
    const path = srcPath(rel)
    const text = existsSync(path) ? readFileSync(path, 'utf8') : null
    parsedSources.set(rel, text === null ? null : ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true))
  }
  return parsedSources.get(rel) ?? null
}

function isDefaultExport(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement)) return !statement.isExportEquals
  if (!ts.isFunctionDeclaration(statement) && !ts.isClassDeclaration(statement)) return false
  return (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0
}

function declaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of source.statements) {
    if (isDefaultExport(statement)) names.add('default')
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text)
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) names.add(declaration.name.getText())
  }
  return names
}

function declarationOf(rel: string, name: string, seen = new Set<string>()): string {
  const source = parsed(rel)
  if (!source || seen.has(rel) || declaredNames(source).has(name)) return `${rel}::${name}`
  seen.add(rel)
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const target = moduleFile(rel, statement.moduleSpecifier.text)
    const clause = statement.exportClause
    if (!target) continue
    if (!clause) {
      const found = declarationOf(target, name, seen)
      const declaring = parsed(found.split('::')[0])
      if (declaring && declaredNames(declaring).has(name)) return found
    } else if (ts.isNamedExports(clause)) {
      const spec = clause.elements.find((element) => element.name.text === name)
      if (spec) return declarationOf(target, (spec.propertyName ?? spec.name).text, seen)
    }
  }
  return `${rel}::${name}`
}

function importBindings(rel: string, source: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const target = moduleFile(rel, statement.moduleSpecifier.text)
    const clause = statement.importClause
    if (target && clause?.name) bindings.set(clause.name.text, declarationOf(target, 'default'))
    const named = clause?.namedBindings
    if (!target || !named) continue
    if (ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, `ns:${target}`)
      continue
    }
    for (const element of named.elements) {
      bindings.set(element.name.text, declarationOf(target, (element.propertyName ?? element.name).text))
    }
  }
  return bindings
}

const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

function branches(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isIfStatement(parent)) return child !== parent.expression
  if (ts.isConditionalExpression(parent)) return child !== parent.condition
  if (ts.isBinaryExpression(parent)) return SHORT_CIRCUIT.has(parent.operatorToken.kind) && child === parent.right
  if (ts.isTryStatement(parent)) return parent.catchClause !== undefined && child === parent.tryBlock
  return ts.isCaseClause(parent) || ts.isDefaultClause(parent) || ts.isCatchClause(parent) || ts.isIterationStatement(parent, false)
}

function transparent(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
}

const UNREAD_METHOD = '[computed]'

function accessedMethod(access: ts.Node, on: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(access) && access.expression === on) return access.name.text
  if (!ts.isElementAccessExpression(access) || access.expression !== on) return null
  return ts.isStringLiteralLike(access.argumentExpression) ? access.argumentExpression.text : UNREAD_METHOD
}

interface ChainEnd {
  end: ts.Node
  swallowed: boolean
  settled: boolean
}

function promiseChain(start: ts.Node): ChainEnd {
  let node = start
  let settled = false
  for (;;) {
    while (transparent(node.parent)) {
      settled ||= ts.isAwaitExpression(node.parent)
      node = node.parent
    }
    if (settled) return { end: node, swallowed: false, settled }
    const parent = node.parent
    if (ts.isArrayLiteralExpression(parent)) {
      const combinator = parent.parent
      const all =
        ts.isCallExpression(combinator) && combinator.arguments[0] === parent && combinator.expression.getText() === 'Promise.all'
      if (!all) return { end: node, swallowed: true, settled }
      node = combinator
      continue
    }
    const method = accessedMethod(parent, node)
    if (method === 'catch' || method === UNREAD_METHOD) return { end: node, swallowed: true, settled }
    const chained = parent.parent
    if ((method !== 'then' && method !== 'finally') || !ts.isCallExpression(chained) || chained.expression !== parent) {
      return { end: node, swallowed: false, settled }
    }
    if (method === 'then' && chained.arguments.length > 1) return { end: node, swallowed: true, settled }
    node = chained
  }
}

function resultDiscarded(call: ts.CallExpression, root: ts.Node): boolean {
  const { end, swallowed, settled } = promiseChain(call)
  if (swallowed) return true
  const parent = end.parent
  if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) return true
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.CommaToken) return parent.left === end
  if (!ts.isVariableDeclaration(parent) || parent.initializer !== end) return false
  if (!bindingNames(parent.name).some((name) => readsOf(root, name).length > 0)) return true
  return !settled && ts.isIdentifier(parent.name) && swallowedThrough(root, parent.name, new Set())
}

function swallowedThrough(root: ts.Node, declared: ts.Identifier, seen: Set<string>): boolean {
  seen.add(declared.text)
  return readsOf(root, declared).some((read) => {
    const { end, swallowed, settled } = promiseChain(read)
    if (swallowed) return true
    const parent = end.parent
    if (settled || !ts.isVariableDeclaration(parent) || parent.initializer !== end || !ts.isIdentifier(parent.name)) return false
    return !seen.has(parent.name.text) && swallowedThrough(root, parent.name, seen)
  })
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name]
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)))
}

function readsOf(root: ts.Node, declared: ts.Identifier): ts.Identifier[] {
  const found: ts.Identifier[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== declared && node.text === declared.text) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function propertyKey(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  return name.getText()
}

function accessorPrefix(member: ts.Node): string {
  if (ts.isGetAccessorDeclaration(member)) return 'get '
  if (ts.isSetAccessorDeclaration(member)) return 'set '
  return ''
}

function bodiless(member: ts.ClassElement): boolean {
  const bodied =
    ts.isMethodDeclaration(member) ||
    ts.isConstructorDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  return bodied && member.body === undefined
}

function onClass(member: ts.ClassElement): boolean {
  if (ts.isClassStaticBlockDeclaration(member)) return true
  return ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
}

interface Unit {
  name: string
  node: ts.Node
  thisPrefix?: string
  root?: ts.Node
}

function unwrapped(expression: ts.Expression): ts.Expression {
  let node = expression
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression
  }
  return node
}

function unitsOfValue(
  name: string,
  node: ts.Node,
  value: ts.Expression | undefined,
  around?: string,
  receiver?: string
): Unit[] {
  const inner = value === undefined ? undefined : unwrapped(value)
  if (inner && ts.isClassExpression(inner)) return classUnits(name, inner)
  if (inner && ts.isObjectLiteralExpression(inner)) return objectUnits(name, inner, around)
  const fn = inner && ts.isFunctionLike(inner) ? inner : undefined
  const thisPrefix = fn && !ts.isArrowFunction(fn) ? receiver : around
  return [{ name, node, ...(thisPrefix === undefined ? {} : { thisPrefix }), ...(fn ? { root: fn } : {}) }]
}

function classUnits(className: string, declaration: ts.ClassLikeDeclaration): Unit[] {
  return declaration.members.flatMap((member): Unit[] => {
    if (ts.isIndexSignatureDeclaration(member) || bodiless(member)) return []
    const thisPrefix = onClass(member) ? `${className}.static ` : `${className}.`
    if (ts.isClassStaticBlockDeclaration(member)) {
      const line = member.getSourceFile().getLineAndCharacterOfPosition(member.getStart()).line + 1
      return [{ name: `${className}.(static block, line ${line})`, node: member, thisPrefix }]
    }
    const name = ts.isConstructorDeclaration(member) ? 'constructor' : member.name && propertyKey(member.name)
    if (!name) return []
    const key = `${thisPrefix}${accessorPrefix(member)}${name}`
    if (ts.isPropertyDeclaration(member)) return unitsOfValue(key, member, member.initializer, thisPrefix, thisPrefix)
    return [{ name: key, node: member, thisPrefix, ...(ts.isFunctionLike(member) ? { root: member } : {}) }]
  })
}

function objectUnits(owner: string, literal: ts.ObjectLiteralExpression, around?: string): Unit[] {
  const thisAround = around === undefined ? {} : { thisPrefix: around }
  return literal.properties.flatMap((property): Unit[] => {
    if (ts.isSpreadAssignment(property)) {
      const line = property.getSourceFile().getLineAndCharacterOfPosition(property.getStart()).line + 1
      return [{ name: `${owner}.(spread, line ${line})`, node: property, ...thisAround }]
    }
    if (ts.isShorthandPropertyAssignment(property)) return []
    const key = `${owner}.${accessorPrefix(property)}${propertyKey(property.name)}`
    if (ts.isPropertyAssignment(property)) return unitsOfValue(key, property, property.initializer, around, `${owner}.`)
    return [{ name: key, node: property, thisPrefix: `${owner}.`, root: property }]
  })
}

function unitsOf(source: ts.SourceFile, statement: ts.Statement): Unit[] {
  if (ts.isFunctionDeclaration(statement)) {
    if (!statement.body) return []
    return [{ name: statement.name?.text ?? 'default', node: statement, root: statement }]
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      unitsOfValue(declaration.name.getText(), declaration, declaration.initializer)
    )
  }
  if (ts.isClassDeclaration(statement)) return classUnits(statement.name?.text ?? 'default', statement)
  if (ts.isExportAssignment(statement)) return unitsOfValue('default', statement, statement.expression)
  if (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEmptyStatement(statement)
  ) {
    return []
  }
  const line = source.getLineAndCharacterOfPosition(statement.getStart()).line + 1
  return [{ name: `(top level, line ${line})`, node: statement }]
}

export function functionsInSource(source: ts.SourceFile): TopLevelFunction[] {
  const rel = source.fileName
  const locals = declaredNames(source)
  const imports = importBindings(rel, source)
  const resolve = (expression: ts.Expression, thisPrefix: string | undefined): string | null => {
    if (ts.isIdentifier(expression)) {
      if (locals.has(expression.text)) return `${rel}::${expression.text}`
      return imports.get(expression.text) ?? expression.text
    }
    if (!ts.isPropertyAccessExpression(expression)) return null
    if (thisPrefix && expression.expression.kind === ts.SyntaxKind.ThisKeyword) return `${rel}::${thisPrefix}${expression.name.text}`
    const owner = ts.isIdentifier(expression.expression) ? imports.get(expression.expression.text) : undefined
    if (owner?.startsWith('ns:')) return declarationOf(owner.slice(3), expression.name.text)
    return `?.${expression.name.text}`
  }
  const found: TopLevelFunction[] = []
  for (const unit of source.statements.flatMap((statement) => unitsOf(source, statement))) {
    const { name, thisPrefix } = unit
    const fn: TopLevelFunction = {
      key: `${rel}::${name}`,
      name,
      file: rel,
      identifiers: new Set(),
      callsRecord: false,
      recordedKinds: [],
      buildsObjectRead: false,
      calls: [],
    }
    const ordered: Array<ResolvedCall & { end: number }> = []
    const visit = (node: ts.Node, conditional: boolean): void => {
      if (ts.isIdentifier(node)) fn.identifiers.add(node.text)
      if (ts.isNewExpression(node) && node.expression.getText() === 'GetObjectCommand') fn.buildsObjectRead = true
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = resolve(node.expression, thisPrefix)
        const optional = ts.isCallExpression(node) && node.questionDotToken !== undefined
        const discarded = ts.isCallExpression(node) && resultDiscarded(node, unit.node)
        if (target) ordered.push({ end: node.getEnd(), target, conditional: conditional || optional, discarded })
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText()
        if (callee === 'getSignedUrl') fn.buildsObjectRead = true
        if (callee === 'recordDocumentAccess') {
          fn.callsRecord = true
          const kind = node.arguments[2]
          if (kind && ts.isStringLiteralLike(kind)) fn.recordedKinds.push(kind.text)
        }
      }
      const callback = ts.isFunctionLike(node) && node !== unit.root
      ts.forEachChild(node, (child) => visit(child, conditional || callback || branches(node, child)))
    }
    visit(unit.node, false)
    fn.calls = ordered
      .sort((a, b) => a.end - b.end)
      .map(({ target, conditional, discarded }) => ({ target, conditional, discarded }))
    found.push(fn)
  }
  return found
}

const ACCESS_CHECK = 'lib/documents/access.ts::getAccessibleDocument'
const BYTE_STEPS = new Set(['GetObjectCommand', 'getSignedUrl', 'lib/download-log/service.ts::recordDocumentAccess'])

export function accessCheckedFirst(functions: readonly TopLevelFunction[]): Set<string> {
  const keys = functions.map((fn) => fn.key)
  const shared = keys.filter((key, index) => keys.indexOf(key) !== index)
  if (shared.length > 0) throw new Error(`Two units share a key, so a check in one would cover the other: ${[...new Set(shared)].join(', ')}`)
  const reads = new Set(functions.filter((fn) => fn.buildsObjectRead || fn.callsRecord).map((fn) => fn.key))
  for (let grew = true; grew; ) {
    grew = false
    for (const fn of functions) {
      if (reads.has(fn.key) || !fn.calls.some(({ target }) => target !== fn.key && reads.has(target))) continue
      reads.add(fn.key)
      grew = true
    }
  }
  const checked = new Set<string>()
  const asks = (call: ResolvedCall): boolean =>
    !call.conditional && !call.discarded && (call.target === ACCESS_CHECK || checked.has(call.target))
  for (let grew = true; grew; ) {
    grew = false
    for (const fn of functions) {
      if (checked.has(fn.key)) continue
      const first = fn.calls.find(
        (call) => call.target !== fn.key && (asks(call) || BYTE_STEPS.has(call.target) || reads.has(call.target))
      )
      if (!first || !asks(first)) continue
      checked.add(fn.key)
      grew = true
    }
  }
  return checked
}

const LOG_MODULE = 'lib/download-log/'

export const FILES = sourceFiles()
const ALL_FUNCTIONS = FILES.flatMap(topLevelFunctions)
export const CALLERS = ALL_FUNCTIONS.filter((fn) => !fn.file.startsWith(LOG_MODULE))
export const ROUTE_FILES = FILES.filter((file) => /[\\/]app[\\/]api[\\/].*route\.ts$/.test(file))
