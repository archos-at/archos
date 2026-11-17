import 'server-only'
import { createZip, type ZipEntry } from '@/lib/bim/zip'
import {
  AI_GENERATOR_NAME,
  AI_PROVENANCE_PROPERTIES,
  digitalSourceTypeOf,
  type AiProvenance,
} from '@/lib/ai-provenance'
import type { DocBlock, DocRun } from './blocks'

const PAGE_WIDTH_TWIPS = 11906
const PAGE_HEIGHT_TWIPS = 16838
const MARGIN_TWIPS = 1134
const CONTENT_WIDTH_TWIPS = PAGE_WIDTH_TWIPS - 2 * MARGIN_TWIPS

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export const escapeXml = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const renderRun = (run: DocRun): string => {
  if (!run.text) return ''
  const properties = [
    run.bold ? '<w:b/>' : '',
    run.italic ? '<w:i/>' : '',
    run.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
  ].join('')
  const body = run.text
    .split('\n')
    .map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join('<w:br/>')
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${body}</w:r>`
}

const renderParagraph = (runs: DocRun[], style?: string, extraProperties = ''): string => {
  const pPr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${extraProperties}`
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs.map(renderRun).join('')}</w:p>`
}

const SPACER = '<w:p/>'

const renderCell = (runs: DocRun[], width: number, header: boolean): string => {
  const shading = header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''
  const content = header ? runs.map((run) => ({ ...run, bold: true })) : runs
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shading}</w:tcPr>` +
    `${renderParagraph(content.length > 0 ? content : [{ text: '' }], 'TableText')}</w:tc>`
  )
}

const BORDER =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
    .join('') +
  '</w:tblBorders>'

const renderTable = (block: Extract<DocBlock, { kind: 'table' }>): string => {
  const columns = Math.max(block.head?.length ?? 0, ...block.rows.map((row) => row.length), 1)
  const width = Math.floor(CONTENT_WIDTH_TWIPS / columns)
  const widths = Array.from({ length: columns }, (_, index) =>
    index === columns - 1 ? CONTENT_WIDTH_TWIPS - width * (columns - 1) : width
  )

  const pad = (row: DocRun[][]): DocRun[][] =>
    Array.from({ length: columns }, (_, index) => row[index] ?? [{ text: '' }])

  const headerRow = block.head
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.head
        .map((text, index) => renderCell([{ text }], widths[index], true))
        .join('')}</w:tr>`
    : ''

  const bodyRows = block.rows
    .map(
      (row) =>
        `<w:tr>${pad(row)
          .map((runs, index) => renderCell(runs, widths[index], false))
          .join('')}</w:tr>`
    )
    .join('')

  return (
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
    `${BORDER}<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>` +
    '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    `${headerRow}${bodyRows}</w:tbl>${SPACER}`
  )
}

const renderBlock = (block: DocBlock): string => {
  switch (block.kind) {
    case 'heading':
      return renderParagraph([{ text: block.text }], `Heading${block.level}`)
    case 'paragraph':
      return renderParagraph(
        block.runs,
        block.style === 'meta' ? 'Meta' : block.style === 'quote' ? 'Quote' : 'Body'
      )
    case 'bullets':
      return block.items
        .map((runs) =>
          renderParagraph(
            [{ text: '• ' }, ...runs],
            'Body',
            '<w:ind w:left="360" w:hanging="360"/>'
          )
        )
        .join('')
    case 'table':
      return renderTable(block)
    case 'rule':
      return renderParagraph(
        [],
        undefined,
        '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="BFBFBF"/></w:pBdr>' +
          '<w:spacing w:before="120" w:after="180"/>'
      )
  }
}

const SECTION =
  `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH_TWIPS}" w:h="${PAGE_HEIGHT_TWIPS}"/>` +
  `<w:pgMar w:top="${MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${MARGIN_TWIPS}" ` +
  `w:left="${MARGIN_TWIPS}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export type DocxProvenance = AiProvenance

export interface DocxOptions {
  aiProvenance?: DocxProvenance
}

const CUSTOM_PROPERTIES_FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'

const customProperties = (provenance: DocxProvenance): string => {
  const properties: { name: string; value: string }[] = [
    { name: AI_PROVENANCE_PROPERTIES.generated, value: '<vt:bool>true</vt:bool>' },
    {
      name: AI_PROVENANCE_PROPERTIES.generator,
      value: `<vt:lpwstr>${escapeXml(AI_GENERATOR_NAME)}</vt:lpwstr>`,
    },
    { name: AI_PROVENANCE_PROPERTIES.humanReviewed, value: '<vt:bool>false</vt:bool>' },
    {
      name: AI_PROVENANCE_PROPERTIES.digitalSourceType,
      value: `<vt:lpwstr>${digitalSourceTypeOf(provenance)}</vt:lpwstr>`,
    },
  ]
  if (provenance.runId) {
    properties.push({
      name: AI_PROVENANCE_PROPERTIES.runId,
      value: `<vt:lpwstr>${escapeXml(provenance.runId)}</vt:lpwstr>`,
    })
  }

  return (
    XML_DECLARATION +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    properties
      .map(
        (property, index) =>
          `<property fmtid="${CUSTOM_PROPERTIES_FMTID}" pid="${index + 2}" ` +
          `name="${escapeXml(property.name)}">${property.value}</property>`
      )
      .join('') +
    '</Properties>'
  )
}

const contentTypes = (withProvenance: boolean): string =>
  XML_DECLARATION +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  (withProvenance
    ? '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>'
    : '') +
  '</Types>'

const packageRels = (withProvenance: boolean): string =>
  XML_DECLARATION +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  (withProvenance
    ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>'
    : '') +
  '</Relationships>'

const DOCUMENT_RELS =
  XML_DECLARATION +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>'

const style = (id: string, name: string, definition: string): string =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
  `<w:basedOn w:val="Normal"/><w:qFormat/>${definition}</w:style>`

const heading = (level: number, size: number, spacing: number): string =>
  style(
    `Heading${level}`,
    `heading ${level}`,
    `<w:pPr><w:keepNext/><w:spacing w:before="${spacing}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`
  )

const STYLES =
  XML_DECLARATION +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>' +
  '<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>' +
  heading(1, 36, 0) +
  heading(2, 28, 240) +
  heading(3, 24, 200) +
  heading(4, 23, 160) +
  heading(5, 22, 120) +
  style('Body', 'Body Text', '') +
  style(
    'Meta',
    'Meta',
    '<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="20"/></w:rPr>'
  ) +
  style(
    'Quote',
    'Quote',
    '<w:pPr><w:ind w:left="360"/><w:spacing w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr>'
  ) +
  style(
    'TableText',
    'Table Text',
    '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr>'
  ) +
  '</w:styles>'

export function renderDocx(blocks: DocBlock[], options: DocxOptions = {}): Uint8Array {
  const provenance = options.aiProvenance
  const body = blocks.map(renderBlock).join('')
  const document =
    XML_DECLARATION +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}${SPACER}${SECTION}</w:body></w:document>`

  const entries: ZipEntry[] = [
    { path: '[Content_Types].xml', content: contentTypes(Boolean(provenance)) },
    { path: '_rels/.rels', content: packageRels(Boolean(provenance)) },
    { path: 'word/document.xml', content: document },
    { path: 'word/_rels/document.xml.rels', content: DOCUMENT_RELS },
    { path: 'word/styles.xml', content: STYLES },
  ]
  if (provenance) {
    entries.push({ path: 'docProps/custom.xml', content: customProperties(provenance) })
  }
  return createZip(entries)
}

export const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
