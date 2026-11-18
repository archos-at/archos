/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { agentDocumentFilename, deliveredFilename } from './agent-namespace'
import { contentDisposition } from './content-disposition'
import { storageName } from './generated'

describe('the name a filed agent file downloads under', () => {
  const filed = agentDocumentFilename('0b6c3c39-8d62-4c62-9a3f-7d1c1f0d2a11', 'Flächenaufstellung Haus B.xlsx')

  it('was the namespaced row name, which a browser saves as generated_<uuid>_…', () => {
    expect(filed).toBe('generated/0b6c3c39-8d62-4c62-9a3f-7d1c1f0d2a11/Flächenaufstellung Haus B.xlsx')
    expect(contentDisposition('attachment', filed)).toContain("filename*=UTF-8''generated%2F")
  })

  it('is the plain name, umlauts and spaces kept in filename*', () => {
    expect(deliveredFilename(filed)).toBe('Flächenaufstellung Haus B.xlsx')
    expect(contentDisposition('attachment', deliveredFilename(filed))).toBe(
      "attachment; filename=\"Fl_chenaufstellung Haus B.xlsx\"; filename*=UTF-8''Fl%C3%A4chenaufstellung%20Haus%20B.xlsx",
    )
  })

  it('leaves a person’s file name alone', () => {
    expect(deliveredFilename('Raumbuch Stand 2026-11-18.xlsx')).toBe('Raumbuch Stand 2026-11-18.xlsx')
  })
})

describe('the storage key of a filed agent file', () => {
  it('stays ASCII while the name keeps its umlauts', () => {
    expect(storageName('Flächenaufstellung Haus B.xlsx')).toBe('Flaechenaufstellung-Haus-B.xlsx')
    expect(storageName('Straße.DOCX')).toBe('Strasse.docx')
  })
})
