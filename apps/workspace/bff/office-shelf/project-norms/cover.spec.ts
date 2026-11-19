/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/stored-copy', () => ({
  storedFileOf: vi.fn(async (_file: unknown, name: string) => new File([new Uint8Array([1])], name, { type: 'application/pdf' })),
}))
vi.mock('@/lib/pdf/cover-text', () => ({ readCoverText: vi.fn() }))

import { storedFileOf } from '@/lib/documents/stored-copy'
import { readCoverText } from '@/lib/pdf/cover-text'
import { MAX_COVER_FILE_BYTES, MAX_COVER_READS, withCovers, type CoverFile } from './cover'
import type { RecognizedNorm } from './placement'

const COVER = 'ÖNORM B 1600\nBarrierefreies Bauen – Planungsgrundlagen\nAusgabe: 2023-02-01\nErsatz für ÖNORM B 1600:2017-04-15'

let run = 0

function norm(documentId: string, fileName = 'OENORM_B_1600_2017.pdf'): RecognizedNorm {
  return { documentId, fileName, folderId: null, designation: 'ÖNORM B 1600', kind: 'technical_standard', editionLabel: '2017', issuedOn: null, contentHash: 'h' }
}

function file(id: string, extra: Partial<CoverFile> = {}): CoverFile {
  return { id, filename: 'OENORM_B_1600_2017.pdf', storageBucket: null, storageKey: `k/${id}`, contentType: 'application/pdf', contentHash: `hash-${run}-${id}`, fileSize: 1000, ...extra }
}

const filesOf = (...files: CoverFile[]) => new Map(files.map((one) => [one.id, one]))

beforeEach(() => {
  run += 1
  vi.mocked(readCoverText).mockResolvedValue(COVER)
})

describe('the cover page of an offered project norm', () => {
  it('fills the edition and designation, and wins over the file name', async () => {
    const [read] = await withCovers('org-1', [norm('a')], filesOf(file('a')))
    expect(read).toMatchObject({ designation: 'ÖNORM B 1600', editionLabel: '2023-02-01', issuedOn: '2023-02-01' })
  })

  it('keeps the file name’s reading when the page has no text', async () => {
    vi.mocked(readCoverText).mockResolvedValue(null)
    expect(await withCovers('org-1', [norm('a')], filesOf(file('a')))).toEqual([norm('a')])
  })

  it('keeps the file name’s reading when the stored bytes cannot be read', async () => {
    vi.mocked(storedFileOf).mockRejectedValueOnce(new Error('S3 down'))
    expect(await withCovers('org-1', [norm('a')], filesOf(file('a')))).toEqual([norm('a')])
  })

  it('reads no file that is not a PDF or is too large', async () => {
    const files = filesOf(file('a', { contentType: 'image/png', filename: 'scan.png' }), file('b', { fileSize: MAX_COVER_FILE_BYTES + 1 }))
    await withCovers('org-1', [norm('a'), norm('b')], files)
    expect(storedFileOf).not.toHaveBeenCalled()
  })

  it('reads a few files per request, and each file once', async () => {
    const ids = Array.from({ length: MAX_COVER_READS + 2 }, (_, index) => `d${index}`)
    const files = filesOf(...ids.map((id) => file(id)))
    const first = await withCovers('org-1', ids.map((id) => norm(id)), files)
    expect(readCoverText).toHaveBeenCalledTimes(MAX_COVER_READS)
    expect(first.filter((one) => one.editionLabel === '2023-02-01')).toHaveLength(MAX_COVER_READS)
    const second = await withCovers('org-1', ids.map((id) => norm(id)), files)
    expect(readCoverText).toHaveBeenCalledTimes(MAX_COVER_READS + 2)
    expect(second.every((one) => one.editionLabel === '2023-02-01')).toBe(true)
  })

  it('keeps one office’s reading from another', async () => {
    await withCovers('org-1', [norm('a')], filesOf(file('a')))
    await withCovers('org-2', [norm('a')], filesOf(file('a')))
    expect(readCoverText).toHaveBeenCalledTimes(2)
  })
})
