/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'

vi.mock('server-only', () => ({}))

interface CapturedQuery {
  sql: string
  params: unknown[]
}

const captured: CapturedQuery[] = []
let answer: unknown[][] = []

const proxyDb = drizzle(async (sql, params) => {
  captured.push({ sql, params })
  return { rows: answer }
})

vi.mock('@/lib/db', () => ({ getDb: () => proxyDb }))
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: (_scope: unknown, fn: () => unknown) => fn(),
  withOptionalTenant: (_scope: unknown, fn: () => unknown) => fn(),
}))

import {
  DOCUMENT_LIST_LIMIT,
  findProjectDocumentsByFilenames,
  findProjectDocumentsByNames,
  findShelfDocumentListRow,
  listDocumentLevelPage,
  listDocumentPage,
  listProjectDocumentPage,
  listShelfFailedDocuments,
  summarizeShelfFolders,
} from './repository'
import { FILENAME_LOOKUP_MAX_NAMES } from './filename-lookup'
import {
  findOfficeShelfDocumentsByFilenames,
  findOfficeShelfDocumentsByNames,
  listOfficeShelfDocumentLevel,
} from '@/lib/office-shelf/repository'
import {
  decodeDocumentLevelCursor,
  decodeDocumentListCursor,
  encodeDocumentLevelCursor,
  encodeDocumentListCursor,
  type DocumentLevelCursor,
} from './list-cursor'
import type { DocumentLevelQuery } from './list-query'
import { projectShelf } from './shelf'
import { REVIEWER_READER } from './document-reader'

const reader = REVIEWER_READER

function wireRow(n: number, cursorCreatedAt = `2026-01-01T00:00:00.${String(n).padStart(6, '0')}`): unknown[] {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  return [
    id, // id
    `plan-${n}.pdf`, // filename
    'proj-1', // projectId
    'project', // scope
    null, // displayName
    100, // fileSize
    'application/pdf', // contentType
    'completed', // status
    'user', // authoredBy
    null, // authoredByProducer
    null, // publishedVersionId
    'active', // lifecycle
    'proj_c', // collectionName
    null, // folderId
    null, // originPath
    null, // contentHash
    'user-1', // createdBy
    null, // screeningOutcome
    null, // screenedHash
    '2026-01-01T00:00:00.000Z', // createdAt
    '2026-01-01T00:00:00.000Z', // updatedAt
    null, // errorMessage
    null, // quarantine
    null, // metadata
    null, // ingestFailureCategory
    null, // ingestRetryable
    null, // ingestReaderVersion
    cursorCreatedAt, // cursorCreatedAt
  ]
}

function onlyQuery(): CapturedQuery {
  expect(captured).toHaveLength(1)
  return captured[0]
}

beforeEach(() => {
  captured.length = 0
  answer = []
})

describe('listProjectDocumentPage', () => {
  it('asks for one probe row past the page, never more than the cap', async () => {
    await listProjectDocumentPage('p1', 'org-1', { reader, limit: 10_000 })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/order by "documents"\."created_at" desc, "documents"\."id" asc/i)
    expect(sql).toMatch(/limit \$\d+$/i)
    expect(params.at(-1)).toBe(DOCUMENT_LIST_LIMIT + 1)
  })

  it('bounds a nonsense limit below as well', async () => {
    await listProjectDocumentPage('p1', 'org-1', { reader, limit: -5 })
    expect(onlyQuery().params.at(-1)).toBe(2)
  })

  it('reports no next page when the probe row did not come back', async () => {
    answer = [wireRow(1), wireRow(2)]
    const page = await listProjectDocumentPage('p1', 'org-1', { reader, limit: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.nextCursor).toBeNull()
  })

  it('drops the probe row and points the cursor at the last row it kept', async () => {
    answer = [wireRow(1), wireRow(2), wireRow(3)]
    const page = await listProjectDocumentPage('p1', 'org-1', { reader, limit: 2 })
    expect(page.rows.map((row) => row.filename)).toEqual(['plan-1.pdf', 'plan-2.pdf'])
    expect(page.nextCursor).toEqual({
      createdAt: '2026-01-01T00:00:00.000002',
      id: '00000000-0000-4000-8000-000000000002',
    })
    expect(page.rows[0]).not.toHaveProperty('cursorCreatedAt')
    expect(page.rows[0].createdAt).toBeInstanceOf(Date)
  })

  it('reads the cursor column at microsecond precision in UTC', async () => {
    await listProjectDocumentPage('p1', 'org-1', { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/to_char\(("documents"\.)?"created_at" AT TIME ZONE 'UTC', \$\d+\)/)
    expect(params).toContain('YYYY-MM-DD"T"HH24:MI:SS.US')
  })

  it('starts strictly after the cursor, with the id breaking a timestamp tie', async () => {
    const cursor = { createdAt: '2026-01-01T00:00:00.123456', id: '00000000-0000-4000-8000-000000000009' }
    await listProjectDocumentPage('p1', 'org-1', { reader, cursor })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(
      /"documents"\."created_at" < \(\$\d+::timestamp AT TIME ZONE 'UTC'\) OR \("documents"\."created_at" = \(\$\d+::timestamp AT TIME ZONE 'UTC'\) AND "documents"\."id" > \$\d+::uuid\)/,
    )
    expect(params).toEqual(expect.arrayContaining([cursor.createdAt, cursor.id]))
  })

  it('keeps the tenant and shelf predicates beside the cursor', async () => {
    await listProjectDocumentPage('p1', 'org-1', {
      reader,
      cursor: { createdAt: '2026-01-01T00:00:00.000000', id: '00000000-0000-4000-8000-000000000001' },
    })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"documents"\."project_id" = \$\d+/)
    expect(sql).toMatch(/"documents"\."organization_id" = \$\d+/)
    expect(sql).toMatch(/"documents"\."scope" = \$\d+/)
    expect(sql).toMatch(/"documents"\."lifecycle" = \$\d+/)
    expect(params).toEqual(expect.arrayContaining(['p1', 'org-1', 'project', 'active']))
  })
})

describe('listDocumentPage on the office shelf', () => {
  it('pages the Archiv with the same order, bound and cursor', async () => {
    const cursor = { createdAt: '2026-01-01T00:00:00.000001', id: '00000000-0000-4000-8000-000000000001' }
    answer = [wireRow(1), wireRow(2)]
    const page = await listDocumentPage({ kind: 'office_shelf' }, 'org-1', { reader, cursor, limit: 1 })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"documents"\."scope" = \$\d+/)
    expect(sql).toMatch(/order by "documents"\."created_at" desc, "documents"\."id" asc/i)
    expect(sql).toMatch(/"documents"\."id" > \$\d+::uuid/)
    expect(params).toEqual(expect.arrayContaining(['org-1', 'office_shelf', cursor.id]))
    expect(params.at(-1)).toBe(2)
    expect(page.rows).toHaveLength(1)
    expect(page.nextCursor?.id).toBe('00000000-0000-4000-8000-000000000001')
  })
})

describe('findOfficeShelfDocumentsByFilenames', () => {
  it('asks nothing for no names', async () => {
    expect(await findOfficeShelfDocumentsByFilenames('org-1', [], { reader })).toEqual([])
    expect(captured).toHaveLength(0)
  })

  it('looks the names up in both Unicode forms, bounded, inside the Archiv shelf', async () => {
    const composed = 'Übersicht.pdf'.normalize('NFC')
    await findOfficeShelfDocumentsByFilenames('org-1', [composed], { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"documents"\."filename" in \(\$\d+, \$\d+\)/)
    expect(params).toEqual(expect.arrayContaining([composed, composed.normalize('NFD'), 'office_shelf', 'org-1']))
    expect(params.at(-1)).toBe(DOCUMENT_LIST_LIMIT)
  })

  it('matches a name the reader spelled in another case', async () => {
    await findOfficeShelfDocumentsByFilenames('org-1', ['DETAIL.PDF'], { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/lower\("documents"\."filename"\) in/)
    expect(params).toEqual(expect.arrayContaining(['DETAIL.PDF', 'detail.pdf']))
  })
})

describe('findProjectDocumentsByFilenames', () => {
  it('asks nothing for no names', async () => {
    expect(await findProjectDocumentsByFilenames('p1', 'org-1', ['', '  '], { reader })).toEqual([])
    expect(captured).toHaveLength(0)
  })

  it('matches the filename exactly or case-folded, on the listing\'s own shelf and lifecycle', async () => {
    const decomposed = 'Übersicht.PDF'.normalize('NFD')
    await findProjectDocumentsByFilenames('p1', 'org-1', [decomposed], { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"documents"\."project_id" = \$\d+/)
    expect(sql).toMatch(/"documents"\."scope" = \$\d+/)
    expect(sql).toMatch(/"documents"\."lifecycle" = \$\d+/)
    expect(sql).toMatch(/"documents"\."filename" in \(\$\d+, \$\d+\)/)
    expect(sql).toMatch(/lower\("documents"\."filename"\) in/)
    expect(sql).not.toMatch(/display_name"\) in/)
    const nfc = 'Übersicht.PDF'.normalize('NFC')
    expect(params).toEqual(
      expect.arrayContaining(['p1', 'org-1', 'project', 'active', nfc, nfc.normalize('NFD'), nfc.toLowerCase()]),
    )
    expect(params.at(-1)).toBe(DOCUMENT_LIST_LIMIT)
  })

  it('bounds how many names one query carries', async () => {
    const names = Array.from({ length: FILENAME_LOOKUP_MAX_NAMES + 50 }, (_, i) => `f${i}.pdf`)
    await findProjectDocumentsByFilenames('p1', 'org-1', names, { reader })
    const { params } = onlyQuery()
    expect(params).toContain(`f${FILENAME_LOOKUP_MAX_NAMES - 1}.pdf`)
    expect(params).not.toContain(`f${FILENAME_LOOKUP_MAX_NAMES}.pdf`)
  })
})

describe('the cursor codec', () => {
  const cursor = { createdAt: '2026-01-01T00:00:00.123456', id: '00000000-0000-4000-8000-000000000001' }

  it('round-trips', () => {
    expect(decodeDocumentListCursor(encodeDocumentListCursor(cursor))).toEqual(cursor)
  })

  it.each([
    ['garbage', 'not-a-cursor'],
    ['empty', ''],
    ['millisecond precision', Buffer.from(JSON.stringify({ t: '2026-01-01T00:00:00.123', i: cursor.id })).toString('base64url')],
    ['a non-uuid id', Buffer.from(JSON.stringify({ t: cursor.createdAt, i: "1' OR 1=1" })).toString('base64url')],
    ['an oversized value', 'a'.repeat(500)],
  ])('refuses %s', (_label, encoded) => {
    expect(decodeDocumentListCursor(encoded)).toBeNull()
  })
})

describe('findProjectDocumentsByNames', () => {
  it('matches identity and alias keys, person-uploaded rows, every lifecycle', async () => {
    const decomposed = 'Übersicht.pdf'.normalize('NFD')
    await findProjectDocumentsByNames('p1', 'org-1', [decomposed], { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"documents"\."authored_by" = \$\d+/)
    expect(sql).toMatch(/"documents"\."filename" in \(\$\d+, \$\d+\)/)
    expect(sql).toMatch(/lower\("documents"\."filename"\) in/)
    expect(sql).toMatch(/lower\("documents"\."display_name"\) in/)
    expect(sql).not.toMatch(/"lifecycle" =/)
    const nfc = 'Übersicht.pdf'.normalize('NFC')
    expect(params).toEqual(
      expect.arrayContaining(['user', 'p1', 'org-1', 'project', nfc, nfc.normalize('NFD'), nfc.toLowerCase()]),
    )
  })

  it('splits a long probe into bounded queries and returns each row once', async () => {
    answer = [[
      '00000000-0000-4000-8000-000000000001', 'a.pdf', null, 1, null, null, 'user', 'active',
    ]]
    const names = Array.from({ length: 700 }, (_, i) => `f${i}.pdf`)
    const rows = await findProjectDocumentsByNames('p1', 'org-1', names, { reader })
    expect(captured).toHaveLength(2)
    for (const query of captured) expect(query.params.at(-1)).toBe(2000)
    expect(rows).toHaveLength(1)
  })
})

describe('findOfficeShelfDocumentsByNames', () => {
  it('probes the Archiv shelf the same way', async () => {
    await findOfficeShelfDocumentsByNames('org-1', ['EG.pdf'], { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/"documents"\."scope" = \$\d+/)
    expect(sql).toMatch(/lower\("documents"\."filename"\) in/)
    expect(sql).not.toMatch(/"lifecycle" =/)
    expect(params).toEqual(expect.arrayContaining(['org-1', 'office_shelf', 'user', 'EG.pdf', 'eg.pdf']))
  })
})

describe('listDocumentLevelPage', () => {
  const shelf = projectShelf('p1')
  const level = (overrides: Partial<DocumentLevelQuery> = {}): DocumentLevelQuery => ({
    folderId: null,
    sort: 'added',
    dir: 'desc',
    limit: 100,
    ...overrides,
  })
  const levelRow = (n: number, cursorValue: string): unknown[] => [...wireRow(n).slice(0, -1), cursorValue]

  it('reads one level of the shelf, newest first, behind the listing predicates', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ folderId: '00000000-0000-4000-8000-0000000000f1' }) })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/(?:"documents"\.)?"folder_id" = \$\d+/)
    expect(sql).toMatch(/(?:"documents"\.)?"project_id" = \$\d+/)
    expect(sql).toMatch(/(?:"documents"\.)?"lifecycle" = \$\d+/)
    expect(sql).toMatch(/order by (?:"documents"\.)?"created_at" desc, (?:"documents"\.)?"id" asc/i)
    expect(params).toEqual(expect.arrayContaining(['p1', 'org-1', 'project', 'active', '00000000-0000-4000-8000-0000000000f1']))
    expect(params.at(-1)).toBe(101)
  })

  it('reads the root as the documents filed in no folder', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ folderId: null }) })
    expect(onlyQuery().sql).toMatch(/(?:"documents"\.)?"folder_id" is null/)
  })

  it('reads the whole shelf when no folder is named (a search)', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ folderId: undefined, q: 'Grundriss' }) })
    const { sql } = onlyQuery()
    expect(sql).not.toMatch(/"folder_id" (=|is null)/)
    expect(sql).toMatch(/strpos\(fold_german\((?:"documents"\.)?"filename"\), fold_german\(\$\d+\)\) > 0/)
    expect(sql).toMatch(/strpos\(fold_german\(coalesce\((?:"documents"\.)?"display_name", ''\)\), fold_german\(\$\d+\)\) > 0/)
  })

  it('folds the name and what was typed alike in SQL (Unicode form, umlaut spelling), with no wildcard', async () => {
    const decomposed = 'Übersicht'.normalize('NFD')
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ q: `  ${decomposed} 50%_ ` }) })
    const { sql, params } = onlyQuery()
    expect(sql).not.toMatch(/ like /i)
    expect(params).toEqual(expect.arrayContaining([`${decomposed} 50%_`]))
  })

  it('orders by the shown name, case-folded, and reads the cursor by the same expression', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ sort: 'name', dir: 'asc' }) })
    const { sql } = onlyQuery()
    expect(sql).toMatch(
      /order by lower\(coalesce\((?:"documents"\.)?"display_name", (?:"documents"\.)?"filename"\)\) asc, (?:"documents"\.)?"id" asc/i,
    )
    expect(sql).toMatch(/select .*lower\(coalesce\((?:"documents"\.)?"display_name", (?:"documents"\.)?"filename"\)\) from/i)
  })

  it('orders by size with an unknown size as the smallest', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ sort: 'size', dir: 'desc' }) })
    const { sql } = onlyQuery()
    expect(sql).toMatch(/order by coalesce\((?:"documents"\.)?"file_size", -1\) desc, (?:"documents"\.)?"id" asc/i)
    expect(sql).toMatch(/coalesce\((?:"documents"\.)?"file_size", -1\)::text/)
  })

  it.each([
    ['added', 'desc', '2026-01-01T00:00:00.123456', /(?:"documents"\.)?"created_at" < \(\$\d+::timestamp AT TIME ZONE 'UTC'\)/],
    ['added', 'asc', '2026-01-01T00:00:00.123456', /(?:"documents"\.)?"created_at" > \(\$\d+::timestamp AT TIME ZONE 'UTC'\)/],
    ['name', 'asc', 'plan eg.pdf', /lower\(coalesce\((?:"documents"\.)?"display_name", (?:"documents"\.)?"filename"\)\) > \$\d+::text/],
    ['size', 'desc', '2048', /coalesce\((?:"documents"\.)?"file_size", -1\) < \$\d+::integer/],
  ] as const)('starts strictly after a %s %s cursor, the id breaking ties ascending', async (sort, dir, value, past) => {
    const cursor: DocumentLevelCursor = { sort, dir, value, id: '00000000-0000-4000-8000-000000000009' }
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ sort, dir, cursor }) })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(past)
    expect(sql).toMatch(/AND (?:"documents"\.)?"id" > \$\d+::uuid\)\)/)
    expect(params).toEqual(expect.arrayContaining([value, cursor.id]))
  })

  it('keeps every row of a full page, drops the probe row and points the cursor at the last kept one', async () => {
    answer = [levelRow(1, 'a.pdf'), levelRow(2, 'b.pdf'), levelRow(3, 'c.pdf')]
    const page = await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ sort: 'name', dir: 'asc', limit: 2 }) })
    expect(page.rows.map((row) => row.filename)).toEqual(['plan-1.pdf', 'plan-2.pdf'])
    expect(page.nextCursor).toEqual({ sort: 'name', dir: 'asc', value: 'b.pdf', id: '00000000-0000-4000-8000-000000000002' })
    expect(page.rows[0]).not.toHaveProperty('cursorValue')
    expect(page.rows[0].createdAt).toBeInstanceOf(Date)
  })

  it('reports no next page when the probe row did not come back', async () => {
    answer = [levelRow(1, '10'), levelRow(2, '5')]
    const page = await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ sort: 'size', limit: 2 }) })
    expect(page.nextCursor).toBeNull()
  })

  it('clamps the page to the listing cap, and a nonsense limit to one row', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ limit: 10_000 }) })
    expect(captured.at(-1)?.params.at(-1)).toBe(DOCUMENT_LIST_LIMIT + 1)
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ limit: -3 }) })
    expect(captured.at(-1)?.params.at(-1)).toBe(2)
  })

  it('narrows to read-state families by the status vocabulary, unknown statuses counted as being read', async () => {
    await listDocumentLevelPage(shelf, 'org-1', { reader, level: level({ states: ['failed', 'reading'] }) })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/lower\((?:"documents"\.)?"status"\) in \(/)
    expect(sql).toMatch(/lower\((?:"documents"\.)?"status"\) not in \(/)
    expect(params).toEqual(expect.arrayContaining(['failed', 'error', 'ready', 'quarantined', 'stored']))
  })

  it('asks no family predicate when every family is asked for', async () => {
    await listDocumentLevelPage(shelf, 'org-1', {
      reader,
      level: level({ states: ['readable', 'reading', 'failed', 'held', 'unindexed'] }),
    })
    expect(onlyQuery().sql).not.toMatch(/"status"\)/)
  })

  it('reads the Archiv shelf the same way', async () => {
    await listOfficeShelfDocumentLevel('org-1', { reader, level: level() })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/(?:"documents"\.)?"scope" = \$\d+/)
    expect(sql).not.toMatch(/(?:"documents"\.)?"project_id" = /)
    expect(params).toEqual(expect.arrayContaining(['org-1', 'office_shelf']))
  })
})

describe('the level cursor codec', () => {
  const cursor: DocumentLevelCursor = {
    sort: 'name',
    dir: 'asc',
    value: 'übersicht eg.pdf',
    id: '00000000-0000-4000-8000-000000000001',
  }
  const raw = (body: unknown) => Buffer.from(JSON.stringify(body)).toString('base64url')

  it('round-trips every order', () => {
    expect(decodeDocumentLevelCursor(encodeDocumentLevelCursor(cursor))).toEqual(cursor)
    const added = { ...cursor, sort: 'added', dir: 'desc', value: '2026-01-01T00:00:00.123456' } as const
    expect(decodeDocumentLevelCursor(encodeDocumentLevelCursor(added))).toEqual(added)
    const size = { ...cursor, sort: 'size', value: '-1' } as const
    expect(decodeDocumentLevelCursor(encodeDocumentLevelCursor(size))).toEqual(size)
  })

  it('is not mistaken for a listing cursor, nor a listing cursor for it', () => {
    const listing = encodeDocumentListCursor({ createdAt: '2026-01-01T00:00:00.123456', id: cursor.id })
    expect(decodeDocumentLevelCursor(listing)).toBeNull()
    expect(decodeDocumentListCursor(encodeDocumentLevelCursor(cursor))).toBeNull()
  })

  it.each([
    ['garbage', 'not-a-cursor'],
    ['empty', ''],
    ['an unknown order', raw({ s: 'status', d: 'asc', v: 'x', i: cursor.id })],
    ['an unknown direction', raw({ s: 'name', d: 'up', v: 'x', i: cursor.id })],
    ['an added key at millisecond precision', raw({ s: 'added', d: 'desc', v: '2026-01-01T00:00:00.123', i: cursor.id })],
    ['a size key that is not a number', raw({ s: 'size', d: 'desc', v: '1; DROP TABLE documents', i: cursor.id })],
    ['a non-uuid id', raw({ s: 'name', d: 'asc', v: 'x', i: "1' OR 1=1" })],
    ['an oversized key', raw({ s: 'name', d: 'asc', v: 'x'.repeat(2000), i: cursor.id })],
  ])('refuses %s', (_label, encoded) => {
    expect(decodeDocumentLevelCursor(encoded)).toBeNull()
  })
})

describe('summarizeShelfFolders', () => {
  it('groups the listing rows by folder and counts each family by its declared statuses', async () => {
    await summarizeShelfFolders(projectShelf('p1'), 'org-1', { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/group by (?:"documents"\.)?"folder_id"/i)
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE lower\((?:"documents"\.)?"status"\) in \(/)
    expect(sql).toMatch(/(?:"documents"\.)?"lifecycle" = \$\d+/)
    expect(params).toEqual(expect.arrayContaining(['p1', 'org-1', 'project', 'completed', 'failed', 'quarantined', 'stored']))
    expect(sql).toMatch(/limit \$\d+$/i)
  })

  it('coerces the counts and leaves the rest of the total to the reading family', async () => {
    answer = [
      [null, '10', '6', '1', '1', '1', '2026-03-01T10:00:00.000Z'],
      ['00000000-0000-4000-8000-0000000000f1', 3, 3, 0, 0, 0, null],
    ]
    const rows = await summarizeShelfFolders(projectShelf('p1'), 'org-1', { reader })
    expect(rows).toEqual([
      { folderId: null, total: 10, readable: 6, reading: 1, failed: 1, held: 1, unindexed: 1, latest: '2026-03-01T10:00:00.000Z' },
      {
        folderId: '00000000-0000-4000-8000-0000000000f1',
        total: 3,
        readable: 3,
        reading: 0,
        failed: 0,
        held: 0,
        unindexed: 0,
        latest: null,
      },
    ])
  })
})

describe('listShelfFailedDocuments', () => {
  it('asks for the failed family, newest first, one probe row past the limit', async () => {
    answer = Array.from({ length: 1001 }, (_, n) => [`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, null])
    const result = await listShelfFailedDocuments(projectShelf('p1'), 'org-1', { reader })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/lower\((?:"documents"\.)?"status"\) in \(\$\d+, \$\d+\)/)
    expect(params).toEqual(expect.arrayContaining(['failed', 'error']))
    expect(params.at(-1)).toBe(1001)
    expect(result.failed).toHaveLength(1000)
    expect(result.failedTruncated).toBe(true)
  })
})

describe('findShelfDocumentListRow', () => {
  it('reads one document through the listing predicates', async () => {
    await findShelfDocumentListRow(projectShelf('p1'), 'org-1', '00000000-0000-4000-8000-000000000001', {
      reader,
      includeArchived: true,
    })
    const { sql, params } = onlyQuery()
    expect(sql).toMatch(/(?:"documents"\.)?"id" = \$\d+/)
    expect(sql).toMatch(/(?:"documents"\.)?"project_id" = \$\d+/)
    expect(sql).not.toMatch(/"lifecycle" =/)
    expect(params).toEqual(expect.arrayContaining(['00000000-0000-4000-8000-000000000001', 'p1', 'org-1']))
  })
})
