import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type SqlToken = { kind: 'word' | 'quoted' | 'string' | 'symbol'; text: string }
export type SqlStatement = { tokens: SqlToken[]; text: string }

const WORD = /[A-Za-z_][\w$]*/y
const NUMBER = /\d+(?:\.\d+)?/y

function dollarTag(sql: string, at: number): string | null {
  const match = /\$[A-Za-z_]*\$/y
  match.lastIndex = at
  return match.exec(sql)?.[0] ?? null
}

function closing(sql: string, at: number, quote: string): number {
  let i = at + 1
  while (i < sql.length) {
    if (sql[i] === quote && sql[i + 1] === quote) i += 2
    else if (sql[i] === quote) return i + 1
    else i += 1
  }
  return sql.length
}

export function tokenizeSql(sql: string): SqlToken[][] {
  const statements: SqlToken[][] = [[]]
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]!
    const current = statements[statements.length - 1]!
    if (/\s/.test(ch)) i += 1
    else if (sql.startsWith('--', i)) i = sql.indexOf('\n', i) === -1 ? sql.length : sql.indexOf('\n', i)
    else if (sql.startsWith('/*', i)) i = sql.indexOf('*/', i) === -1 ? sql.length : sql.indexOf('*/', i) + 2
    else if (ch === "'") {
      const end = closing(sql, i, "'")
      current.push({ kind: 'string', text: sql.slice(i + 1, end - 1).replaceAll("''", "'") })
      i = end
    } else if (ch === '"') {
      const end = closing(sql, i, '"')
      current.push({ kind: 'quoted', text: sql.slice(i + 1, end - 1).replaceAll('""', '"') })
      i = end
    } else if (ch === '$' && dollarTag(sql, i)) {
      const tag = dollarTag(sql, i)!
      const end = sql.indexOf(tag, i + tag.length)
      const body = sql.slice(i + tag.length, end === -1 ? sql.length : end)
      current.push({ kind: 'string', text: body })
      i = end === -1 ? sql.length : end + tag.length
    } else if (ch === ';') {
      statements.push([])
      i += 1
    } else {
      WORD.lastIndex = i
      NUMBER.lastIndex = i
      const word = WORD.exec(sql) ?? NUMBER.exec(sql)
      if (word) {
        current.push({ kind: 'word', text: word[0] })
        i += word[0].length
      } else {
        current.push({ kind: 'symbol', text: ch })
        i += 1
      }
    }
  }
  return statements.filter((tokens) => tokens.length > 0)
}

export function parseSql(sql: string): SqlStatement[] {
  return tokenizeSql(sql).map((tokens) => ({ tokens, text: tokens.map((t) => t.text).join(' ') }))
}

export function readSql(file: string, root: string = process.cwd()): SqlStatement[] {
  return parseSql(readFileSync(file.startsWith('/') ? file : join(root, file), 'utf8'))
}

export function startsWith(statement: SqlStatement, ...words: string[]): boolean {
  return words.every((word, i) => statement.tokens[i]?.kind === 'word' && statement.tokens[i]!.text.toUpperCase() === word.toUpperCase())
}

function nameAt(tokens: SqlToken[], at: number): string | undefined {
  let i = at
  while (tokens[i]?.kind === 'word' && ['IF', 'NOT', 'EXISTS', 'ONLY'].includes(tokens[i]!.text.toUpperCase())) i += 1
  const parts: string[] = []
  while (tokens[i] && (tokens[i]!.kind === 'word' || tokens[i]!.kind === 'quoted')) {
    parts.push(tokens[i]!.text)
    if (tokens[i + 1]?.text !== '.') break
    i += 2
  }
  return parts.at(-1)
}

export function createdTables(statements: SqlStatement[]): string[] {
  return statements.flatMap((statement) => {
    const words = statement.tokens.map((t) => (t.kind === 'word' ? t.text.toUpperCase() : ''))
    if (words[0] !== 'CREATE') return []
    const table = words.indexOf('TABLE')
    if (table < 1 || table > 3) return []
    const name = nameAt(statement.tokens, table + 1)
    return name ? [name] : []
  })
}

export function functionCalls(statements: SqlStatement[], name: string): SqlToken[][] {
  const calls: SqlToken[][] = []
  for (const { tokens } of statements) {
    tokens.forEach((token, i) => {
      if (token.kind !== 'word' || token.text.toLowerCase() !== name.toLowerCase() || tokens[i + 1]?.text !== '(') return
      const args: SqlToken[] = []
      let depth = 0
      for (const next of tokens.slice(i + 1)) {
        if (next.text === '(') depth += 1
        if (next.text === ')') depth -= 1
        if (depth === 0) break
        if (!(depth === 1 && (next.text === '(' || next.text === ','))) args.push(next)
      }
      calls.push(args)
    })
  }
  return calls
}

export type ConstraintClause = { statement: SqlStatement; action: string; name: string; check?: SqlToken[] }

const isSymbol = (token: SqlToken | undefined, text: string): boolean => token?.kind === 'symbol' && token.text === text
const isWord = (token: SqlToken | undefined, word: string): boolean =>
  token?.kind === 'word' && token.text.toUpperCase() === word.toUpperCase()

function insideParens(tokens: SqlToken[], open: number): SqlToken[] {
  let depth = 0
  for (let i = open; i < tokens.length; i += 1) {
    if (isSymbol(tokens[i], '(')) depth += 1
    else if (isSymbol(tokens[i], ')')) depth -= 1
    if (depth === 0) return tokens.slice(open + 1, i)
  }
  return tokens.slice(open + 1)
}

// Every `[ADD|DROP] CONSTRAINT name [CHECK (expression)]`, in ALTER TABLE and in CREATE TABLE.
// `action` is ADD or DROP, or '' inside CREATE TABLE.
export function constraintClauses(statements: SqlStatement[]): ConstraintClause[] {
  return statements.flatMap((statement) => {
    const { tokens } = statement
    return tokens.flatMap((token, i) => {
      if (!isWord(token, 'CONSTRAINT')) return []
      let at = i + 1
      while (['IF', 'NOT', 'EXISTS'].some((word) => isWord(tokens[at], word))) at += 1
      const name = tokens[at]
      if (name?.kind !== 'word' && name?.kind !== 'quoted') return []
      const action = ['ADD', 'DROP'].find((word) => isWord(tokens[i - 1], word)) ?? ''
      const check = isWord(tokens[at + 1], 'CHECK') && isSymbol(tokens[at + 2], '(') ? insideParens(tokens, at + 2) : undefined
      return [{ statement, action, name: name.text, check }]
    })
  })
}

// The string values listed in `"column" IN ('a', 'b', ...)` within a CHECK expression, in order.
export function listedValues(expression: SqlToken[], column: string): string[] {
  const at = expression.findIndex(
    (token, i) =>
      token.kind === 'quoted' && token.text === column && isWord(expression[i + 1], 'IN') && isSymbol(expression[i + 2], '('),
  )
  if (at === -1) return []
  return insideParens(expression, at + 2).flatMap((token) => (token.kind === 'string' ? [token.text] : []))
}
