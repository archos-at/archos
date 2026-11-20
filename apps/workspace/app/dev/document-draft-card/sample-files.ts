const encodePdfText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, (char) => `\\${char.charCodeAt(0).toString(8).padStart(3, '0')}`)

export interface SampleLine {
  text: string
  x: number
  y: number
  size: number
  bold?: boolean
}

export function samplePdfDataUrl(lines: readonly SampleLine[], rules: readonly number[] = []): string {
  const stream = [
    ...rules.map((y) => `0.85 G 0.6 w 56 ${y} m 539 ${y} l S`),
    ...lines.map(
      (line) => `BT /${line.bold ? 'F2' : 'F1'} ${line.size} Tf ${line.x} ${line.y} Td (${encodePdfText(line.text)}) Tj ET`,
    ),
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const latin1 = Array.from(body, (char) => String.fromCharCode(char.charCodeAt(0) & 0xff)).join('')
  return `data:application/pdf;base64,${btoa(latin1)}`
}

const AREA_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['1.01', 'Wohnen / Essen', '38,42'],
  ['1.02', 'Küche', '9,80'],
  ['1.03', 'Zimmer 1', '14,25'],
  ['1.04', 'Zimmer 2', '12,60'],
  ['1.05', 'Bad', '6,35'],
  ['1.06', 'WC', '1,95'],
  ['1.07', 'Vorraum', '7,10'],
  ['1.08', 'Abstellraum', '2,40'],
]

export const AREA_SCHEDULE_PDF = samplePdfDataUrl(
  [
    { text: 'Flächenaufstellung Top 4', x: 56, y: 770, size: 18, bold: true },
    { text: 'Wohnhausanlage Seestraße 12 · Stand 18.11.2026', x: 56, y: 748, size: 10 },
    { text: 'Nr.', x: 56, y: 712, size: 10, bold: true },
    { text: 'Raum', x: 110, y: 712, size: 10, bold: true },
    { text: 'Fläche m²', x: 460, y: 712, size: 10, bold: true },
    ...AREA_ROWS.flatMap(([nr, room, area], index) => [
      { text: nr, x: 56, y: 690 - index * 22, size: 10 },
      { text: room, x: 110, y: 690 - index * 22, size: 10 },
      { text: area, x: 470, y: 690 - index * 22, size: 10 },
    ]),
    { text: 'Summe Nutzfläche', x: 110, y: 500, size: 10, bold: true },
    { text: '92,87', x: 470, y: 500, size: 10, bold: true },
  ],
  [705, ...AREA_ROWS.map((_, index) => 683 - index * 22), 515],
)

export const MEMO_PDF = samplePdfDataUrl([
  { text: 'Aktenvermerk', x: 56, y: 770, size: 20, bold: true },
  { text: 'Abweichung Fluchtweglänge, 2. Obergeschoß', x: 56, y: 744, size: 12 },
  { text: 'Projekt: Wohnhausanlage Seestraße 12', x: 56, y: 712, size: 10 },
  { text: 'Datum: 18.11.2026', x: 56, y: 696, size: 10 },
  { text: 'Sachverhalt', x: 56, y: 660, size: 12, bold: true },
  { text: 'Die Fluchtweglänge vom Ende des Ganges bis zum Stiegenhaus beträgt', x: 56, y: 640, size: 10 },
  { text: 'laut Einreichplanung 41,5 m und überschreitet damit die zulässigen 40 m.', x: 56, y: 626, size: 10 },
  { text: 'Vorgeschlagene Kompensation', x: 56, y: 596, size: 12, bold: true },
  { text: '1. Rauchwarnmelder in allen Aufenthaltsräumen, vernetzt.', x: 56, y: 576, size: 10 },
  { text: '2. Zusätzliche Sicherheitsbeleuchtung im Gang.', x: 56, y: 562, size: 10 },
  { text: '3. Abstimmung mit dem Brandschutzplaner bis 25.11.2026.', x: 56, y: 548, size: 10 },
])

export const SECTION_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">',
    '<rect width="320" height="220" fill="#ffffff"/>',
    '<g fill="none" stroke="#1f2023" stroke-width="3">',
    '<path d="M30 190 H290"/><path d="M50 190 V70 L160 20 L270 70 V190"/>',
    '<path d="M50 130 H270"/><path d="M120 190 V150 H150 V190"/>',
    '</g>',
    '<g fill="#7d7a76" font-family="sans-serif" font-size="11">',
    '<text x="56" y="124">OG +3,10</text><text x="56" y="184">EG ±0,00</text>',
    '</g>',
    '</svg>',
  ].join(''),
)}`
