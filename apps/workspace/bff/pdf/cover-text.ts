import 'server-only'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const COVER_READ_MS = 1500
const PDF_MAGIC = '%PDF-'
const LETTERS_OF_A_TEXT_PAGE = 12
const LETTER = /\p{L}/gu

async function pageText(document: PDFDocumentProxy, number: number): Promise<string> {
  const page = await document.getPage(number)
  const reader = page.streamTextContent().getReader()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text
      for (const item of value.items) if ('str' in item) text += item.hasEOL ? `${item.str}\n` : item.str
    }
  } finally {
    reader.releaseLock()
    page.cleanup()
  }
}

const hasText = (text: string) => (text.match(LETTER)?.length ?? 0) >= LETTERS_OF_A_TEXT_PAGE

async function firstTextPage(document: PDFDocumentProxy): Promise<string | null> {
  const first = await pageText(document, 1)
  if (hasText(first)) return first
  if (document.numPages < 2) return null
  const second = await pageText(document, 2)
  return hasText(second) ? second : null
}

async function readWithin(bytes: Uint8Array, timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  const read = (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: bytes, verbosity: 0, disableFontFace: true, useSystemFonts: false, enableXfa: false })
    try {
      return await Promise.race([task.promise.then(firstTextPage), expired])
    } finally {
      void task.destroy()
    }
  })()
  try {
    return await Promise.race([read, expired])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function readCoverText(file: Blob, { timeoutMs = COVER_READ_MS }: { timeoutMs?: number } = {}): Promise<string | null> {
  try {
    if ((await file.slice(0, PDF_MAGIC.length).text()) !== PDF_MAGIC) return null
    return await readWithin(new Uint8Array(await file.arrayBuffer()), timeoutMs)
  } catch {
    return null
  }
}
