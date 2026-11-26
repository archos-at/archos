import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { NORM_COVERS, normCoverFile } from '@/app/dev/_fixtures/norm-covers'
import { readCoverText } from './cover-text'

describe('the text of a PDF’s cover page', () => {
  it('reads the first page, and only the first', async () => {
    const text = await readCoverText(normCoverFile(NORM_COVERS.onorm))

    expect(text).toContain('ÖNORM B 1600')
    expect(text).toContain('Ausgabe: 2023-02-01')
    expect(text).toContain('Ersatz für ÖNORM B 1600:2017-04-01')
    expect(text).not.toContain('Anwendungsbereich')
  })

  it('reads the second page when the first is a picture without text', async () => {
    const text = await readCoverText(normCoverFile(NORM_COVERS.imageCover))

    expect(text).toContain('Ausgabe: 2023-02-01')
  })

  it.each([
    ['a scan without text', normCoverFile(NORM_COVERS.scan)],
    ['a file that is not a PDF', new File(['ÖNORM B 1600 Ausgabe: 2023-02-01'], 'B1600.pdf', { type: 'application/pdf' })],
    ['a broken PDF', new File(['%PDF-1.4 garbage'], 'B1600.pdf', { type: 'application/pdf' })],
  ])('has nothing for %s', async (_case, file) => {
    expect(await readCoverText(file)).toBeNull()
  })

  it('gives up when the reading outlasts its time, and stops it', async () => {
    const destroy = vi.fn(async () => undefined)
    vi.resetModules()
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: () => ({ promise: new Promise(() => undefined), destroy }) }))
    const { readCoverText: hanging } = await import('./cover-text')
    try {
      expect(await hanging(normCoverFile(NORM_COVERS.onorm), { timeoutMs: 20 })).toBeNull()
      expect(destroy).toHaveBeenCalled()
    } finally {
      vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs')
    }
  })
})
