import { assemblePdf, buildPdf, pdfString } from '../_fixtures/sample-pdf'
import { SHEET_HEIGHT, SHEET_WIDTH } from './fixtures'

const sheetContent = (): string => {
  const ops: string[] = ['0 0 0 RG']
  const rect = (x: number, y: number, w: number, h: number, width = 0.8) =>
    ops.push(`${width} w ${x} ${y} ${w} ${h} re S`)
  const line = (x1: number, y1: number, x2: number, y2: number, width = 0.5) =>
    ops.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`)
  const text = (x: number, y: number, size: number, value: string, bold = false) =>
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(value)}) Tj ET`)

  rect(50, 80, 520, 420, 2.4)
  line(50, 270, 570, 270, 1.2)
  line(50, 320, 570, 320, 1.2)
  for (const x of [190, 330, 450]) {
    line(x, 320, x, 500, 1.2)
    line(x, 80, x, 270, 1.2)
  }
  for (const x of [110, 250, 380, 500]) {
    ops.push(`1 1 1 RG 3 w ${x} 320 m ${x + 26} 320 l S 0 0 0 RG`)
    line(x, 320, x, 346, 0.4)
  }
  rect(470, 110, 80, 140, 0.8)
  for (let step = 0; step <= 9; step += 1) line(470, 110 + step * 14, 550, 110 + step * 14, 0.5)
  for (const [x, y] of [
    [90, 500],
    [230, 500],
    [90, 80],
    [230, 80],
  ]) {
    ops.push(`1 1 1 RG 3 w ${x} ${y} m ${x + 60} ${y} l S 0 0 0 RG`)
    line(x, y - 2, x + 60, y - 2, 0.4)
    line(x, y + 2, x + 60, y + 2, 0.4)
  }
  text(90, 420, 10, 'Wohnen 1')
  text(230, 420, 10, 'Wohnen 2')
  text(370, 420, 10, 'Bad')
  text(480, 420, 10, 'Technik')
  text(90, 180, 10, 'Zimmer 1')
  text(230, 180, 10, 'Zimmer 2')
  text(360, 180, 10, 'Abstellraum')
  text(478, 258, 9, 'Stiege')
  text(240, 292, 10, 'Gang (Fluchtweg)')
  text(50, 515, 12, 'Grundriss Regelgeschoss  1:100', true)
  rect(600, 40, 220, 70, 0.8)
  text(612, 88, 10, 'Wohnbau Nord', true)
  text(612, 70, 9, 'Grundriss RG, Index C')
  text(612, 54, 9, 'Architektur Muster ZT GmbH')
  return ops.join('\n') + '\n'
}

export const buildSheet = (): Uint8Array<ArrayBuffer> => {
  const content = sheetContent()
  return assemblePdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R 7 0 R]/Count 2>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}]` +
      '/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${content.length}>>\nstream\n${content}endstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}]` +
      '/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>',
  ])
}

export const protocolPdf = () =>
  buildPdf([
    [
      ['Anmerkungen – Grundriss_RG_Index-C', 16, true],
      ['Fassung 3 von 3 · Wohnbau Nord — Linz', 10, false],
      ['Nr. 1 · Seite 1 · Mangel · offen', 10, true],
      ['Tür von Wohnen 2 in den Fluchtweg ohne Angabe der Feuerwiderstandsklasse.', 10, false],
    ],
  ])
