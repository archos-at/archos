import { zipSync, zlibSync } from 'fflate'
import { crc32 } from '@/lib/bim/zip'

const encoder = new TextEncoder()
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_DOCUMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const MAIN = {
  docx: { part: 'word/document.xml', type: `${DOCX}.main+xml` },
  xlsx: { part: 'xl/workbook.xml', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' },
  pptx: { part: 'ppt/presentation.xml', type: `${PPTX}.main+xml` },
} as const

export interface OoxmlFixture {
  flavour?: keyof typeof MAIN
  mainType?: string
  extraTypes?: string
  extraParts?: Record<string, string | Uint8Array>
  mainBody?: string
}

export function ooxml({ flavour = 'docx', mainType, extraTypes = '', extraParts = {}, mainBody }: OoxmlFixture = {}): Uint8Array {
  const main = MAIN[flavour]
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/${main.part}" ContentType="${mainType ?? main.type}"/>${extraTypes}</Types>`,
    ),
    '_rels/.rels': encoder.encode(
      `${XML}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="${main.part}"/></Relationships>`,
    ),
    [main.part]: encoder.encode(`${XML}${mainBody ?? '<root/>'}`),
  }
  for (const [name, content] of Object.entries(extraParts)) {
    files[name] = typeof content === 'string' ? encoder.encode(content) : content
  }
  return zipSync(files)
}

export const relationships = (...entries: string[]): string =>
  `${XML}<Relationships xmlns="${RELS_NS}">${entries.join('')}</Relationships>`

export const latin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'))

const PAGE_OBJECTS = (catalogExtra: string): Record<number, string> => ({
  1: `<< /Type /Catalog /Pages 2 0 R${catalogExtra} >>`,
  2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  4: '<< /Title (Bericht \\(Entwurf\\)) /Author (Büro) >>',
})

export function classicPdf(catalogExtra = ''): Uint8Array {
  const objects = PAGE_OBJECTS(catalogExtra)
  let text = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [number, body] of Object.entries(objects)) {
    offsets[Number(number)] = Buffer.byteLength(text, 'latin1')
    text += `${number} 0 obj\n${body}\nendobj\n`
  }
  const xrefAt = Buffer.byteLength(text, 'latin1')
  text += 'xref\n0 5\n0000000000 65535 f \n'
  for (let number = 1; number <= 4; number += 1) text += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size 5 /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return latin1(text)
}

export function pdfWithTable(header: string, body: string, size: number, trailer: string): Uint8Array {
  const text = header + body
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (let number = 1; number < size; number += 1) {
    const at = text.lastIndexOf(`\n${number} 0 obj`) + 1
    table += `${String(at).padStart(10, '0')} 00000 n \n`
  }
  return latin1(`${text}${table}trailer\n${trailer}\nstartxref\n${text.length}\n%%EOF\n`)
}

const STREAM_HIDING = (hidden: string) => `6 0 obj\n<< /Length ${hidden.length} >>\nstream\n${hidden}\nendstream\nendobj\n`

export function objectInsideStreamPdf(): Uint8Array {
  const objects = PAGE_OBJECTS(' /OpenAction 5 0 R')
  const body = Object.entries(objects)
    .map(([number, dictionary]) => `${number} 0 obj\n${dictionary}\nendobj\n`)
    .join('')
  const hidden = '\n5 0 obj\n<< /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj\n'
  return pdfWithTable('%PDF-1.4\n', body + STREAM_HIDING(hidden), 7, '<< /Size 7 /Root 1 0 R /Info 4 0 R >>')
}

export function libreOfficeLikePdf(): Uint8Array {
  const content = Buffer.from(zlibSync(latin1('BT /F1 12 Tf 72 720 Td (Baubeschreibung) Tj ET\n'))).toString('latin1')
  const body =
    `2 0 obj\n<</Length 3 0 R/Filter/FlateDecode>>\nstream\n${content}\nendstream\nendobj\n\n` +
    `3 0 obj\n${content.length}\nendobj\n\n` +
    '5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>\nendobj\n\n' +
    '1 0 obj\n<</Type/Page/Parent 4 0 R/Resources<</Font<</F1 5 0 R>>/ProcSet[/PDF/Text]>>/MediaBox[0 0 595.304 841.89]' +
    '/Group<</S/Transparency/CS/DeviceRGB/I true>>/Contents 2 0 R>>\nendobj\n\n' +
    '4 0 obj\n<</Type/Pages\n/Resources<</Font<</F1 5 0 R>>>>\n/MediaBox[ 0 0 595.304 841.89 ]\n/Kids[ 1 0 R ]\n/Count 1>>\nendobj\n\n' +
    '6 0 obj\n<</Type/Catalog/Pages 4 0 R\n/OpenAction[1 0 R /XYZ null null 0]\n/Lang(de-AT)\n>>\nendobj\n\n' +
    '7 0 obj\n<</Creator<FEFF005700720069007400650072>\n/Producer<FEFF004C0069006200720065004F0066006600690063006500200037002E0036>\n' +
    "/CreationDate(D:20261118120000+01'00')>>\nendobj\n\n"
  const id = '<0F3C2A9B8E7D6C5B4A39281706F5E4D3>'
  return pdfWithTable(
    '%PDF-1.6\n%\xC3\xA4\xC3\xBC\xC3\xB6\xC3\x9F\n',
    body,
    8,
    `<</Size 8/Root 6 0 R\n/Info 7 0 R\n/ID [ ${id}\n${id} ]\n/DocChecksum /5C1B7C6E0B2A4E9F8D7C6B5A49382716\n>>`,
  )
}

function upPredicted(rows: Uint8Array[]): Uint8Array {
  const width = rows[0].length
  const out = new Uint8Array(rows.length * (width + 1))
  rows.forEach((row, index) => {
    out[index * (width + 1)] = 2
    for (let column = 0; column < width; column += 1) {
      const up = index > 0 ? rows[index - 1][column] : 0
      out[index * (width + 1) + 1 + column] = (row[column] - up) & 0xff
    }
  })
  return out
}

export function objectStreamPdf(catalogExtra = ''): Uint8Array {
  const objects = PAGE_OBJECTS(catalogExtra)
  let header = ''
  let body = ''
  for (const [number, dictionary] of Object.entries(objects)) {
    header += `${number} ${body.length} `
    body += `${dictionary}\n`
  }
  const objectStream = zlibSync(latin1(header + body))
  const parts: Uint8Array[] = []
  let length = 0
  const push = (chunk: Uint8Array) => {
    parts.push(chunk)
    length += chunk.length
  }
  push(latin1('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'))
  const streamAt = length
  push(latin1(`5 0 obj\n<< /Type /ObjStm /N 4 /First ${header.length} /Filter /FlateDecode /Length ${objectStream.length} >>\nstream\n`))
  push(objectStream)
  push(latin1('\nendstream\nendobj\n'))
  const xrefAt = length

  const row = (type: number, second: number, third: number) =>
    new Uint8Array([type, (second >>> 24) & 0xff, (second >>> 16) & 0xff, (second >>> 8) & 0xff, second & 0xff, (third >>> 8) & 0xff, third & 0xff])
  const rows = [row(0, 0, 65535), row(2, 5, 0), row(2, 5, 1), row(2, 5, 2), row(2, 5, 3), row(1, streamAt, 0), row(1, xrefAt, 0)]
  const data = zlibSync(upPredicted(rows))
  push(
    latin1(
      `6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R /Info 4 0 R /Filter /FlateDecode ` +
        `/DecodeParms << /Predictor 12 /Columns 7 >> /Length ${data.length} >>\nstream\n`,
    ),
  )
  push(data)
  push(latin1(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`))
  const out = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(encoder.encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export function png(): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, 1)
  view.setUint32(4, 1)
  ihdr.set([8, 0, 0, 0, 0], 8)
  const chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibSync(new Uint8Array([0, 0x80]))),
    pngChunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

export const svg = (inner = '<rect x="0" y="0" width="10" height="10" fill="#ccc"/>'): Uint8Array =>
  encoder.encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Diagramm</title>${inner}</svg>`)
