// @disk-inputs: app/**, bff/**, ui/**, i18n/**, shared/**, types/**, utils/**
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callsTo, importsOf, parseSource, productionSources } from '@/test-utils/source-ast'

const ROOT = join(__dirname, '..')

const WRITERS: Readonly<Record<string, string>> = {
  'bff/pdf/markdown-pdf.ts':
    'research report: Keywords + XMP trainedAlgorithmicMedia, marking required by type (markdown-pdf.spec.ts)',
  'bff/diagrams/svg-to-pdf.tsx': 'diagram PDF: Keywords + XMP (svg-to-pdf.spec.tsx)',
  'bff/answer-export/service.ts': 'answer .docx: custom properties incl. DigitalSourceType (service.spec.ts)',
  'bff/annotations/export.ts':
    'Protokoll PDF and .docx: composite when it holds the agent’s text, unmarked when only the office’s (export.spec.ts)',
}

const WRITER_CALLS = ['renderToBuffer', 'renderToStream', 'renderToFile', 'renderDocx']

const MARKING_MODULE = /^(\.{1,2}|@\/lib)\/(.+\/)?(ai-provenance|xmp-metadata|docx)$/

function callers(): string[] {
  return productionSources(ROOT)
    .filter((path) => /^(app|bff)\//.test(path))
    .filter((path) => {
      const source = parseSource(path, ROOT)
      return WRITER_CALLS.some((name) => callsTo(source, name).length > 0)
    })
    .sort()
}

describe('every PDF and .docx the product writes', () => {
  it('is listed with how it is marked', () => {
    expect(callers()).toEqual(Object.keys(WRITERS).sort())
  })

  it('counts only the repository\'s marking modules, never the bare docx package', () => {
    const marking = ['@/lib/ai-provenance', './xmp-metadata', '@/lib/pdf/xmp-metadata', './docx', '@/lib/answer-export/docx']
    expect(marking.filter((specifier) => !MARKING_MODULE.test(specifier))).toEqual([])
    expect(['docx', 'docx/lib/docx', 'ai-provenance'].filter((specifier) => MARKING_MODULE.test(specifier))).toEqual([])
  })

  it('imports the marking module it applies', () => {
    for (const path of Object.keys(WRITERS)) {
      const specifiers = importsOf(parseSource(path, ROOT)).map((edge) => edge.specifier)
      expect(specifiers.some((specifier) => MARKING_MODULE.test(specifier)), path).toBe(true)
    }
  })
})
