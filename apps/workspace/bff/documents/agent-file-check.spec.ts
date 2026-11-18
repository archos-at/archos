/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { FileTooLargeError } from '@/lib/api/errors'
import { AgentFileRefusedError, checkAgentFile, decodeAgentFileBase64, type AgentFileRefusal } from './agent-file-check'
import { AGENT_FILE_MAX_BYTES } from './agent-file-types'
import {
  classicPdf,
  DOCX,
  latin1,
  objectStreamPdf,
  ooxml,
  png,
  PPTX,
  relationships,
  svg,
  XLSX,
} from './agent-file.fixtures'

const refusalOf = (run: () => unknown): AgentFileRefusal | 'accepted' => {
  try {
    run()
    return 'accepted'
  } catch (error) {
    if (error instanceof AgentFileRefusedError) return error.refusal
    throw error
  }
}

const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
const TEMPLATE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate'
const IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'

describe('the allowlist', () => {
  it.each([
    [DOCX, ooxml()],
    [XLSX, ooxml({ flavour: 'xlsx' })],
    [PPTX, ooxml({ flavour: 'pptx' })],
    ['application/pdf', classicPdf()],
    ['application/pdf', objectStreamPdf()],
    ['image/png', png()],
    ['image/svg+xml', svg()],
  ])('accepts a well-formed %s', (contentType, bytes) => {
    expect(refusalOf(() => checkAgentFile(bytes, contentType))).toBe('accepted')
  })

  it('reads the declared type case- and parameter-insensitively', () => {
    expect(refusalOf(() => checkAgentFile(svg(), 'Image/SVG+XML; charset=utf-8'))).toBe('accepted')
  })

  it('refuses CSV and says to file the table as .xlsx', () => {
    try {
      checkAgentFile(latin1('a;b\n1;2\n'), 'text/csv')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFileRefusedError)
      expect((error as AgentFileRefusedError).refusal).toBe('type-not-allowed')
      expect((error as Error).message).toMatch(/\.xlsx/)
    }
  })

  it.each(['text/html', 'application/zip', 'application/vnd.ms-word.document.macroEnabled.12', 'application/octet-stream'])(
    'refuses %s',
    (contentType) => {
      expect(refusalOf(() => checkAgentFile(ooxml(), contentType))).toBe('type-not-allowed')
    },
  )
})

describe('the bytes are the declared type', () => {
  it.each([
    ['a workbook declared as Word', ooxml({ flavour: 'xlsx' }), DOCX],
    ['a PNG declared as PDF', png(), 'application/pdf'],
    ['a PDF declared as PNG', classicPdf(), 'image/png'],
    ['a PDF declared as Word', classicPdf(), DOCX],
    ['an HTML page declared as SVG', latin1('<html><body/></html>'), 'image/svg+xml'],
  ])('refuses %s', (_case, bytes, contentType) => {
    expect(refusalOf(() => checkAgentFile(bytes, contentType))).toBe('not-the-declared-type')
  })

  it('refuses a PNG whose chunk CRC is wrong', () => {
    const bytes = png()
    bytes[bytes.length - 20] ^= 0xff
    expect(refusalOf(() => checkAgentFile(bytes, 'image/png'))).toBe('malformed')
  })

  it('refuses SVG that is not UTF-8', () => {
    expect(refusalOf(() => checkAgentFile(new Uint8Array([0x3c, 0xff, 0xfe]), 'image/svg+xml'))).toBe(
      'not-the-declared-type',
    )
  })
})

describe('Office files: no macros, no embedded programs, nothing fetched on open', () => {
  it('refuses a macro-enabled document (.docm) by its content type', () => {
    const docm = ooxml({ mainType: 'application/vnd.ms-word.document.macroEnabled.main+xml' })
    expect(refusalOf(() => checkAgentFile(docm, DOCX))).toBe('macro')
  })

  it('refuses a vbaProject.bin even under a macro-free content type', () => {
    const bytes = ooxml({ extraParts: { 'word/vbaProject.bin': new Uint8Array([1, 2, 3]) } })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('macro')
  })

  it('refuses an Excel 4.0 macro sheet', () => {
    const bytes = ooxml({
      flavour: 'xlsx',
      extraTypes: '<Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/>',
    })
    expect(refusalOf(() => checkAgentFile(bytes, XLSX))).toBe('macro')
  })

  it('refuses a remote template (TargetMode="External")', () => {
    const bytes = ooxml({
      extraParts: {
        'word/_rels/document.xml.rels': relationships(
          `<Relationship Id="rId9" Type="${TEMPLATE}" Target="https://evil.example/t.dotm" TargetMode="External"/>`,
        ),
      },
    })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('external-relationship')
  })

  it('refuses a linked image, which Office fetches on open', () => {
    const bytes = ooxml({
      extraParts: {
        'word/_rels/document.xml.rels': relationships(
          `<Relationship TargetMode='External' Id='rId3' Type='${IMAGE}' Target='http://tracker.example/p.png'/>`,
        ),
      },
    })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('external-relationship')
  })

  it('accepts an external hyperlink: the reader clicks it, Office does not fetch it', () => {
    const bytes = ooxml({
      extraParts: {
        'word/_rels/document.xml.rels': relationships(
          `<Relationship Id="rId4" Type="${HYPERLINK}" Target="https://www.ris.bka.gv.at/" TargetMode="External"/>`,
        ),
      },
    })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('accepted')
  })

  it('refuses a hyperlink to a file: URL', () => {
    const bytes = ooxml({
      extraParts: {
        'word/_rels/document.xml.rels': relationships(
          `<Relationship Id="rId4" Type="${HYPERLINK}" Target="file://server/share/x.exe" TargetMode="External"/>`,
        ),
      },
    })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('external-relationship')
  })

  it('refuses an external workbook link', () => {
    const bytes = ooxml({ flavour: 'xlsx', extraParts: { 'xl/externalLinks/externalLink1.xml': '<externalLink/>' } })
    expect(refusalOf(() => checkAgentFile(bytes, XLSX))).toBe('external-relationship')
  })

  it('refuses an OLE object and ActiveX', () => {
    const ole = ooxml({ extraParts: { 'word/embeddings/oleObject1.bin': new Uint8Array([0xd0, 0xcf]) } })
    const activeX = ooxml({ extraParts: { 'word/activeX/activeX1.xml': '<ax/>' } })
    expect(refusalOf(() => checkAgentFile(ole, DOCX))).toBe('embedded-object')
    expect(refusalOf(() => checkAgentFile(activeX, DOCX))).toBe('embedded-object')
  })

  it('accepts the workbook a PowerPoint chart embeds, and checks it too', () => {
    const clean = ooxml({ flavour: 'pptx', extraParts: { 'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx': ooxml({ flavour: 'xlsx' }) } })
    const macro = ooxml({
      flavour: 'pptx',
      extraParts: {
        'ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx': ooxml({
          flavour: 'xlsx',
          mainType: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
        }),
      },
    })
    expect(refusalOf(() => checkAgentFile(clean, PPTX))).toBe('accepted')
    expect(refusalOf(() => checkAgentFile(macro, PPTX))).toBe('macro')
  })

  it('refuses a DDE field split across runs', () => {
    const bytes = ooxml({
      mainBody:
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:instrText> DD</w:instrText></w:r>' +
        '<w:r><w:instrText>EAUTO c:\\\\windows\\\\system32\\\\cmd.exe</w:instrText></w:r></w:p></w:body></w:document>',
    })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('active-content')
  })

  it('does not mistake the word DDE in body text for a field', () => {
    const bytes = ooxml({ mainBody: '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>DDE</w:t></w:r></w:p></w:body></w:document>' })
    expect(refusalOf(() => checkAgentFile(bytes, DOCX))).toBe('accepted')
  })

  it('refuses a DDE formula but not a pipe inside a string', () => {
    const sheet = (formula: string) =>
      ooxml({ flavour: 'xlsx', extraParts: { 'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row><c><f>${formula}</f></c></row></sheetData></worksheet>` } })
    expect(refusalOf(() => checkAgentFile(sheet("cmd|' /C calc'!A0"), XLSX))).toBe('active-content')
    expect(refusalOf(() => checkAgentFile(sheet('CONCAT(&quot;a|b&quot;,A1)'), XLSX))).toBe('accepted')
    expect(refusalOf(() => checkAgentFile(sheet('SUM(A1:A3)'), XLSX))).toBe('accepted')
  })

  it('refuses something that is not a zip at all', () => {
    expect(refusalOf(() => checkAgentFile(latin1('PK\x03\x04garbage'), DOCX))).toBe('malformed')
  })
})

describe('PDF: nothing that runs or reaches out', () => {
  it.each([
    ['a JavaScript open action', ' /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>', 'active-content'],
    ['a launch action', ' /OpenAction << /S /Launch /F (calc.exe) >>', 'active-content'],
    ['a name spelled with # escapes', ' /OpenAction << /S /J#61vaScript /JS (x) >>', 'active-content'],
    ['an embedded file', ' /Names << /EmbeddedFiles 9 0 R >>', 'embedded-object'],
    ['a remote go-to', ' /OpenAction << /S /GoToR /F (http://x.example/a.pdf) >>', 'external-relationship'],
  ] as const)('refuses %s, in a plain file and inside an object stream', (_case, extra, refusal) => {
    expect(refusalOf(() => checkAgentFile(classicPdf(extra), 'application/pdf'))).toBe(refusal)
    expect(refusalOf(() => checkAgentFile(objectStreamPdf(extra), 'application/pdf'))).toBe(refusal)
  })

  it('accepts a link the reader clicks', () => {
    expect(refusalOf(() => checkAgentFile(classicPdf(' /OpenAction << /S /URI /URI (https://x.example) >>'), 'application/pdf'))).toBe(
      'accepted',
    )
  })

  it('refuses an encrypted file it could not mark', () => {
    const encrypted = latin1(
      Buffer.from(classicPdf()).toString('latin1').replace('/Info 4 0 R >>', '/Info 4 0 R /Encrypt 4 0 R >>'),
    )
    expect(refusalOf(() => checkAgentFile(encrypted, 'application/pdf'))).toBe('malformed')
  })
})

describe('SVG: the diagram parser’s rules', () => {
  it.each([
    ['a script', '<script>alert(1)</script>', 'active-content'],
    ['an event handler', '<rect width="1" height="1" onclick="x()"/>', 'active-content'],
    ['an external image', '<image href="https://x.example/a.png"/>', 'external-relationship'],
  ] as const)('refuses %s', (_case, inner, refusal) => {
    expect(refusalOf(() => checkAgentFile(svg(inner), 'image/svg+xml'))).toBe(refusal)
  })
})

describe('the size limit', () => {
  it('answers 413 for a file over 25 MB decoded', () => {
    const over = Buffer.alloc(AGENT_FILE_MAX_BYTES + 1).toString('base64')
    expect(() => decodeAgentFileBase64(over)).toThrow(FileTooLargeError)
    try {
      decodeAgentFileBase64(over)
    } catch (error) {
      expect((error as FileTooLargeError).status).toBe(413)
      expect((error as Error).message).toMatch(/25 MB/)
    }
  })

  it('decodes a file under the limit', () => {
    expect(decodeAgentFileBase64(Buffer.alloc(16).toString('base64')).byteLength).toBe(16)
  })
})
