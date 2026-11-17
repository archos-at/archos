// @disk-inputs: app/**, bff/**
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

const WRITERS: Readonly<Record<string, string>> = {
  'bff/pdf/markdown-pdf.ts':
    'research report: Keywords + XMP trainedAlgorithmicMedia, marking required by type (markdown-pdf.spec.ts)',
  'bff/diagrams/svg-to-pdf.tsx': 'diagram PDF: Keywords + XMP (svg-to-pdf.spec.tsx)',
  'bff/answer-export/service.ts': 'answer .docx: custom properties incl. DigitalSourceType (service.spec.ts)',
  'bff/annotations/export.ts':
    'Protokoll PDF and .docx: composite when it holds the agent’s text, unmarked when only the office’s (export.spec.ts)',
}

const WRITER_CALL = /\b(renderToBuffer|renderToStream|renderToFile|renderDocx)\(/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function callers(): string[] {
  return ['app', 'bff']
    .flatMap((dir) => sources(join(ROOT, dir)))
    .filter((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .some((line) => WRITER_CALL.test(line) && !/export (async )?function render/.test(line))
    )
    .map((path) => relative(ROOT, path))
    .sort()
}

describe('every PDF and .docx the product writes', () => {
  it('is listed with how it is marked', () => {
    expect(callers()).toEqual(Object.keys(WRITERS).sort())
  })

  it('names, in its own source, the marking it applies', () => {
    for (const path of Object.keys(WRITERS)) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      expect(source, path).toMatch(/aiProvenance|withAiProvenanceXmp|AiProvenanceMarking/)
    }
  })
})
