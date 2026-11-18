/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { PDFPageProxy } from 'pdfjs-dist'
import { readPageTextItems } from './pdfjs-runtime'

type TextStream = ReturnType<PDFPageProxy['streamTextContent']>

const safariStream = (chunks: Array<{ items: unknown[]; styles?: Record<string, unknown> }>): TextStream => {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue({ styles: {}, ...chunk, lang: null })
      controller.close()
    },
  })
  Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined })
  return stream as unknown as TextStream
}

const run = (str: string) => ({
  str,
  dir: 'ltr',
  width: 40,
  height: 12,
  transform: [12, 0, 0, 12, 72, '700'],
  fontName: 'f1',
  hasEOL: false,
})

describe('readPageTextItems', () => {
  it('reads every chunk without iterating the stream', async () => {
    const page = {
      streamTextContent: () =>
        safariStream([{ items: [run('Die Sitztreppe')] }, { items: [run('im Innenhof')] }]),
    }

    await expect(async () => {
      for await (const _chunk of page.streamTextContent() as unknown as AsyncIterable<unknown>) {
        // unreachable
      }
    }).rejects.toThrow(TypeError)

    const items = await readPageTextItems(page)

    expect(items.map((item) => item.str)).toEqual(['Die Sitztreppe', 'im Innenhof'])
    expect(items[0]?.transform).toEqual([12, 0, 0, 12, 72, 700])
  })

  it("carries each run's font family, which the passage highlight measures in", async () => {
    const page = {
      streamTextContent: () => safariStream([{ items: [run('Treppenhaus')], styles: { f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } } }]),
    }

    const items = await readPageTextItems(page)

    expect(items[0]?.fontFamily).toBe('sans-serif')
  })

  it('drops marked-content entries, which carry structure and no text', async () => {
    const page = {
      streamTextContent: () =>
        safariStream([{ items: [{ type: 'beginMarkedContent', id: 'mc0' }, run('Absatz')] }]),
    }

    const items = await readPageTextItems(page)

    expect(items.map((item) => item.str)).toEqual(['Absatz'])
  })
})
