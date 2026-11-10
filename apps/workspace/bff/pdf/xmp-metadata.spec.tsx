/**
 * @vitest-environment node
 *
 * The XMP marking, read back by pdf.js: a reader that shares no code with the writer.
 */
import React from 'react'
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import {
  AI_GENERATOR_NAME,
  IPTC_TRAINED_ALGORITHMIC_MEDIA,
  aiProvenanceMarking,
  markingIsInBytes,
} from '@/lib/ai-provenance'
import { PdfMetadataError, withAiProvenanceXmp, withXmpMetadata } from './xmp-metadata'
import { readPdf } from '@/test-utils/read-pdf'

const DIGITAL_SOURCE_TYPE = 'iptc4xmpext:digitalsourcetype'

/** A real react-pdf render: the shape the module appends to in production. */
async function rendered(title = 'Bericht (Entwurf) >> Teil 2'): Promise<Uint8Array> {
  return new Uint8Array(
    await renderToBuffer(
      <Document title={title} keywords="k" creator={AI_GENERATOR_NAME} language="de">
        <Page size="A4">
          <Text>KI-generiert — nicht geprüft</Text>
        </Page>
      </Document>
    )
  )
}

describe('withAiProvenanceXmp', () => {
  const marking = aiProvenanceMarking({ runId: 'run-ä-1' })

  it('a plain render carries no XMP: the positive control for every assertion below', async () => {
    const pdf = await readPdf(await rendered())
    expect(pdf.xmp[DIGITAL_SOURCE_TYPE]).toBeUndefined()
  })

  it('marks the file trainedAlgorithmicMedia in XMP, read back by pdf.js', async () => {
    const pdf = await readPdf(withAiProvenanceXmp(await rendered(), marking))

    expect(pdf.xmp[DIGITAL_SOURCE_TYPE]).toBe(IPTC_TRAINED_ALGORITHMIC_MEDIA)
    expect(pdf.xmp['xmp:creatortool']).toBe(AI_GENERATOR_NAME)
    expect(pdf.xmp['pdf:keywords']).toBe(marking)
  })

  it('leaves the renderer’s bytes, Info dictionary and text as they were', async () => {
    const original = await rendered()
    const marked = withAiProvenanceXmp(original, marking)

    expect(marked.subarray(0, original.length)).toEqual(original)
    expect(markingIsInBytes(marked, marking)).toBe(true)
    const before = await readPdf(original)
    const after = await readPdf(marked)
    expect(after.info.Title).toBe(before.info.Title)
    expect(after.text).toBe(before.text)
    expect(after.pageCount).toBe(1)
  })

  it('refuses a file it cannot append to rather than returning it unmarked', () => {
    const notAPdf = new TextEncoder().encode('%PDF-1.7\nno trailer here')
    expect(() => withXmpMetadata(notAPdf, '<x/>')).toThrow(PdfMetadataError)
  })
})
