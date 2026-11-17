import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript-api'
import { srcEntries, srcPath } from './source-tree'

export { ts }

export type ImportEdge = { specifier: string; names: string[]; typeOnly: boolean; node: ts.Node }

const SCRIPT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const TEST = /\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)(test-utils|mocks|__tests__)\//

export function parseSourceText(text: string, fileName = 'module.tsx'): ts.SourceFile {
  const kind = /\.tsx$|\.jsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
}

export function parseSource(file: string, root: string = process.cwd()): ts.SourceFile {
  const path = file.startsWith('/') ? file : join(root, file)
  return parseSourceText(readFileSync(path, 'utf8'), relative(root, path).replace(/\\/g, '/'))
}

export function productionSources(root: string = process.cwd()): string[] {
  return srcEntries(root)
    .filter((key) => SCRIPT.test(key) && !key.endsWith('.d.ts') && !TEST.test(key))
    .map((key) => relative(root, srcPath(key, root)).replace(/\\/g, '/'))
    .sort()
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

export function nodesOf<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = []
  walk(root, (node) => {
    if (is(node)) found.push(node)
  })
  return found
}

export function importsOf(source: ts.SourceFile): ImportEdge[] {
  const edges: ImportEdge[] = []
  walk(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const names: string[] = []
      if (clause?.name) names.push(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map((e) => (e.propertyName ?? e.name).text))
      if (bindings && ts.isNamespaceImport(bindings)) names.push('*')
      edges.push({ specifier: node.moduleSpecifier.text, names, typeOnly: !!clause?.isTypeOnly, node })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      const names = clause && ts.isNamedExports(clause) ? clause.elements.map((e) => (e.propertyName ?? e.name).text) : ['*']
      edges.push({ specifier: node.moduleSpecifier.text, names, typeOnly: node.isTypeOnly, node })
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      edges.push({ specifier: node.arguments[0].text, names: ['*'], typeOnly: false, node })
    }
  })
  return edges
}

export function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return undefined
}

export function callsTo(root: ts.Node, name: string): ts.CallExpression[] {
  return nodesOf(root, ts.isCallExpression).filter((call) => calleeName(call) === name)
}

export function exportedNames(source: ts.SourceFile): string[] {
  const names: string[] = []
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    const exported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      names.push(...statement.exportClause.elements.map((e) => e.name.text))
    } else if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
      }
    } else if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      names.push(statement.name.text)
    } else if (exported && (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement))) {
      names.push(statement.name.text)
    }
  }
  return names
}

export function stringValues(root: ts.Node): string[] {
  return nodesOf(root, ts.isStringLiteralLike).map((literal) => literal.text)
}

export function lineOf(node: ts.Node): number {
  const source = node.getSourceFile()
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}
