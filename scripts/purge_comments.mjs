// Comment purge for TypeScript and JavaScript; the rule: docs/contributing/code-conventions.md#comments.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('../apps/workspace/node_modules/typescript-api/lib/typescript.js')

const DIRECTIVE =
  /noqa|pragma|eslint-|oxlint-|biome-ignore|prettier-ignore|@ts-(expect-error|ignore|nocheck|check)|istanbul ignore|c8 ignore|v8 ignore|@vitest-environment|@jest-environment|@disk-inputs|@type\s*\{|@typedef|@param\s*\{|@returns?\s*\{|@template|@satisfies|@import|webpack[A-Z]|@vite-ignore|\/\/\/ <reference|@license|@preserve|@__PURE__|#__PURE__/

const isPlainJs = (path) => /\.(c|m)?jsx?$/.test(path)

function commentRanges(sourceFile) {
  const text = sourceFile.getFullText()
  const seen = new Map()
  const visit = (node) => {
    if (node.kind !== ts.SyntaxKind.JsxText) {
      for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) seen.set(range.pos, range)
    }
    for (const child of node.getChildren(sourceFile)) visit(child)
  }
  visit(sourceFile)
  return [...seen.values()]
}

function removableLines(path, text, ranges) {
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (pos) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const lines = text.split('\n')
  const remove = new Set()
  for (const { pos, end } of ranges) {
    const body = text.slice(pos, end)
    if (DIRECTIVE.test(body)) continue
    if (isPlainJs(path) && body.startsWith('/**')) continue
    const first = lineOf(pos)
    const last = lineOf(end - 1)
    if (text.slice(lineStarts[first], pos).trim()) continue
    const lastEnd = last + 1 < lineStarts.length ? lineStarts[last + 1] - 1 : text.length
    if (text.slice(end, lastEnd).trim()) continue
    for (let n = first; n <= last; n++) remove.add(n)
  }
  return { lines, remove }
}

function keepSoleBlockContent(lines, remove) {
  const kept = (n) => !remove.has(n) && lines[n].trim() !== ''
  for (const n of [...remove].sort((a, b) => a - b)) {
    let prev = n - 1
    while (prev >= 0 && !kept(prev)) prev--
    let next = n + 1
    while (next < lines.length && !kept(next)) next++
    const opens = prev >= 0 && /[{(]\s*$/.test(lines[prev])
    const closes = next < lines.length && /^\s*[})]/.test(lines[next])
    if (opens && closes) remove.delete(n)
  }
}

function purge(path) {
  const text = readFileSync(path, 'utf8')
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : isPlainJs(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const { lines, remove } = removableLines(path, text, commentRanges(sourceFile))
  keepSoleBlockContent(lines, remove)
  if (!remove.size) return 0
  const out = []
  for (let n = 0; n < lines.length; n++) {
    if (remove.has(n)) continue
    if (lines[n].trim() === '' && out.length && out[out.length - 1].trim() === '' && remove.has(n - 1)) continue
    out.push(lines[n])
  }
  while (out.length > 1 && out[0].trim() === '' && remove.has(0)) out.shift()
  writeFileSync(path, out.join('\n'))
  return remove.size
}

let total = 0
for (const path of process.argv.slice(2)) total += purge(path)
console.log(`purged ${total} comment line(s) in ${process.argv.length - 2} file(s)`)
