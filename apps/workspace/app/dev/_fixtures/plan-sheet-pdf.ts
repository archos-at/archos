'use client'

import { useEffect, useState } from 'react'
import { assemblePdf, pdfString } from './sample-pdf'

function sheet(title: string, page: number, pages: number): string {
  return [
    '1.2 w 20 20 1150 802 re S',
    '6 w 120 160 640 560 re S',
    '3 w 120 440 m 460 440 l S 460 160 m 460 720 l S 460 520 m 760 520 l S 300 440 m 300 720 l S',
    '1 w 120 300 m 460 300 l S 600 160 m 600 520 l S',
    '0.6 w [8 6] 0 d 90 130 m 790 130 l S 90 750 m 790 750 l S [] 0 d',
    '1.2 w 840 40 310 220 re S 840 120 m 1150 120 l S 840 180 m 1150 180 l S',
    `BT /F1 26 Tf 860 200 Td (${pdfString(title)}) Tj ET`,
    `BT /F1 16 Tf 860 140 Td (Blatt ${page} von ${pages}) Tj ET`,
    'BT /F1 14 Tf 860 70 Td (Huber Architektur ZT GmbH) Tj ET',
  ].join('\n')
}

/** A plan sheet's stand-in for a preview: walls, axes and a title block naming the file, so a thumbnail reads as a drawing. */
export function planSheetPdf(title: string, pages = 3): Uint8Array<ArrayBuffer> {
  const firstPage = 3
  const firstContent = firstPage + pages
  const font = firstContent + pages
  const indices = Array.from({ length: pages }, (_, index) => index)
  return assemblePdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${indices.map((index) => `${firstPage + index} 0 R`).join(' ')}]/Count ${pages}>>`,
    ...indices.map((index) => `<</Type/Page/Parent 2 0 R/MediaBox[0 0 1190 842]/Resources<</Font<</F1 ${font} 0 R>>>>/Contents ${firstContent + index} 0 R>>`),
    ...indices.map((index) => {
      const content = sheet(title, index + 1, pages)
      return `<</Length ${content.length}>>\nstream\n${content}\nendstream`
    }),
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
  ])
}

const PLAN_NUMBER = /^[A-Z]{1,4}[-_ ]?\d/u

/** A letter's stand-in, for what is no drawing: a Bescheid, an offer, a Stellungnahme. */
function letterPdf(title: string): Uint8Array<ArrayBuffer> {
  const lines = [560, 540, 520, 500, 480, 450, 430, 410, 390, 370, 340, 320, 300]
    .map((y, index) => `60 ${y} ${index % 5 === 4 ? 300 : 470} 9 re f`)
    .join('\n')
  const content = [
    '0.12 g 60 760 200 22 re f',
    '0.5 g 60 735 140 8 re f 60 690 180 8 re f 60 675 150 8 re f 380 690 150 8 re f',
    `0 g BT /F1 20 Tf 60 610 Td (${pdfString(title)}) Tj ET`,
    `0.72 g ${lines}`,
    '0.4 g 60 220 120 9 re f',
  ].join('\n')
  return assemblePdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
  ])
}

/** One sample PDF per file name, a plan sheet for a plan number, else a letter; made in the browser and freed when the preview leaves. */
export function useSampleAttachmentUrls(names: readonly string[]): ReadonlyMap<string, string> {
  const key = names.join('\n')
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    const made = new Map(
      key
        .split('\n')
        .filter(Boolean)
        .map((name) => {
          const title = name.replace(/\.pdf$/i, '')
          const bytes = PLAN_NUMBER.test(title) ? planSheetPdf(title) : letterPdf(title)
          return [name, URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))] as const
        })
    )
    setUrls(made)
    return () => made.forEach((url) => URL.revokeObjectURL(url))
  }, [key])
  return urls
}
