// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { callsTo, nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

type ShelfUnit = { path: string; writes: boolean; announces: boolean }

const WRITE_METHODS: readonly string[] = ['update', 'insert', 'delete']
const SHELF_TABLES: readonly string[] = ['documents', 'projectFolders']
const SHELF_SQL = /\b(UPDATE|INSERT INTO|DELETE FROM)\s+(documents|project_folders)\b/

const ANNOUNCED_ELSEWHERE: Record<string, string> = {
  'lib/storage/repository.ts': 'the insert and the replace; `lib/storage/service.ts` and `lib/documents/shelf-upload.ts` announce them',
  'lib/office-shelf/repository.ts': 'the Archiv delete; `lib/office-shelf/service.ts` announces it',
  'lib/projects/folder-bin-repository.ts': 'binning and restoring; `lib/projects/folder-bin.ts` announces them after their transaction',
  'lib/projects/cleanup-repository.ts': 'the empty holder folder; `lib/projects/cleanup-service.ts` announces it',
  'lib/documents/version-repository/content-swap.ts': 'a version’s state, its bytes and archiving; `lib/documents/lifecycle.ts` and `lib/documents/version-content.ts` announce them',
  'lib/documents/version-repository/document-lifecycle.ts': 'a version’s state, its bytes and archiving; `lib/documents/lifecycle.ts` and `lib/documents/version-content.ts` announce them',
  'lib/documents/version-repository/insert.ts': 'a version’s state, its bytes and archiving; `lib/documents/lifecycle.ts` and `lib/documents/version-content.ts` announce them',
  'lib/documents/version-repository/state-swap.ts': 'a version’s state, its bytes and archiving; `lib/documents/lifecycle.ts` and `lib/documents/version-content.ts` announce them',
  'lib/documents/placement-repository.ts': 'which collection a document is indexed in; nothing a listing shows',
  'lib/projects/folder-derived-repository.ts': 'a derived report’s source marker; nothing a listing shows',
  'lib/session-documents/repository.ts': 'chat attachments, which are on no shelf',
}

const ANNOUNCERS = [
  'lib/storage/service.ts',
  'lib/documents/shelf-upload.ts',
  'lib/office-shelf/service.ts',
  'lib/projects/folder-bin.ts',
  'lib/projects/cleanup-service.ts',
  'lib/documents/lifecycle.ts',
  'lib/documents/version-content.ts',
]

function isTextLiteral(
  node: ts.Node
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
}

function isShelfBuilderWrite(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false
  if (!WRITE_METHODS.includes(call.expression.name.text)) return false
  const [target, ...rest] = call.arguments
  return rest.length === 0 && target !== undefined && ts.isIdentifier(target) && SHELF_TABLES.includes(target.text)
}

function writesShelf(source: ts.SourceFile): boolean {
  const viaBuilder = nodesOf(source, ts.isCallExpression).some(isShelfBuilderWrite)
  const viaSql = nodesOf(source, isTextLiteral).some((literal) => SHELF_SQL.test(literal.text))
  return viaBuilder || viaSql
}

function unitOf(path: string): string {
  return path.startsWith('lib/documents/repository') ? 'lib/documents/repository.ts' : path
}

const units = srcEntries()
  .filter((entry) => /\.tsx?$/.test(entry) && !/\.(spec|test|fixtures?)\.tsx?$/.test(entry))
  .filter((entry) => !entry.includes('test-utils') && !entry.startsWith('app/dev'))
  .map((entry): ShelfUnit => {
    const source = parseSource(srcPath(entry))
    return {
      path: unitOf(entry.split('\\').join('/')),
      writes: writesShelf(source),
      announces: callsTo(source, 'publishShelfChanged').length > 0,
    }
  })
  .reduce<Map<string, ShelfUnit>>((byPath, unit) => {
    const existing = byPath.get(unit.path)
    byPath.set(
      unit.path,
      existing
        ? { path: unit.path, writes: existing.writes || unit.writes, announces: existing.announces || unit.announces }
        : unit
    )
    return byPath
  }, new Map())

const writers = [...units.values()].filter((unit) => unit.writes)

describe('every write to a shelf', () => {
  it('is announced on the shelf’s live channel', () => {
    const silent = writers
      .filter((unit) => !unit.announces && !(unit.path in ANNOUNCED_ELSEWHERE))
      .map((unit) => unit.path)
    expect(silent).toEqual([])
  })

  it('keeps the list of exceptions honest: each one still writes, and each announcer still announces', () => {
    const writing = new Set(writers.map((unit) => unit.path))
    expect(Object.keys(ANNOUNCED_ELSEWHERE).filter((path) => !writing.has(path))).toEqual([])
    expect(ANNOUNCERS.filter((path) => !units.get(path)?.announces)).toEqual([])
  })
})
