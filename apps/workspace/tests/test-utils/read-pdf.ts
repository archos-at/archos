import { readPageTextItems } from '@/features/knowledge/lib/pdfjs-runtime'

export interface PdfContents {
  info: Record<string, unknown>
  pageCount: number
  xmp: Record<string, unknown>
  text: string
}

export const normalizePdfText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export async function readPdf(bytes: Uint8Array): Promise<PdfContents> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    standardFontDataUrl: new URL(
      '../../node_modules/pdfjs-dist/standard_fonts/',
      import.meta.url,
    ).href,
  })
  try {
    const document = await task.promise

    const pageCount = document.numPages
    const pages: string[] = []
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await document.getPage(number)
      const items = await readPageTextItems(page)
      pages.push(items.map((item) => item.str).join(' '))
    }

    const { info, metadata } = await document.getMetadata()

    if (!isRecord(info)) throw new Error('the PDF carries no information dictionary')

    const xmp = Object.fromEntries(metadata ? [...metadata] : [])
    return { info, pageCount, xmp, text: normalizePdfText(pages.join(' ')) }
  } finally {
    await task.destroy()
  }
}
