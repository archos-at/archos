/**
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { germanIdentifierWords as germanWords } from '@/test-utils/german-words'

const UI_ROOT = path.resolve(__dirname, '..')
const BASELINE_PATH = path.join(UI_ROOT, 'english-names-baseline.json')

function sourceFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '*.ts', '*.tsx', '*.mts', '*.mjs', '*.js'], {
    cwd: UI_ROOT,
    encoding: 'utf8',
  })
  return listed.split('\n').filter((file) => file && !file.startsWith('public/'))
}

function countIn(file: string): number {
  const text = readFileSync(path.join(UI_ROOT, file), 'utf8')
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') || file.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind)
  let count = 0
  const visit = (node: ts.Node): void => {
    if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && germanWords(node.text).length > 0) count += 1
    ts.forEachChild(node, visit)
  }
  visit(source)
  return count
}

function current(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of sourceFiles()) {
    const count = countIn(file)
    if (count > 0) counts[file] = count
  }
  return counts
}

describe('every name in the UI is English', () => {
  it('reads identifiers by their words, not their substrings', () => {
    expect(germanWords('bundeslandSource')).toEqual(['bundesland'])
    expect(germanWords('GebaeudeklasseInput')).toEqual(['gebaeudeklasse'])
    expect(germanWords('federalState')).toEqual([])
    expect(germanWords('archivedAt')).toEqual([])
    expect(germanWords('archiv_scope')).toEqual(['archiv'])
  })

  const counts = current()
  if (process.env.UPDATE_ENGLISH_NAMES) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>

  it('lets no file gain a German identifier', () => {
    const grown = Object.entries(counts)
      .filter(([file, count]) => count > (baseline[file] ?? 0))
      .map(([file, count]) => `${file}: ${baseline[file] ?? 0} -> ${count}`)
    expect(grown).toEqual([])
  })

  it('moves the baseline down with every cleanup (UPDATE_ENGLISH_NAMES=1)', () => {
    const shrunk = Object.entries(baseline)
      .filter(([file, count]) => (counts[file] ?? 0) < count)
      .map(([file, count]) => `${file}: ${count} -> ${counts[file] ?? 0}`)
    expect(shrunk).toEqual([])
  })
})
