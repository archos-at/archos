import { describe, expect, test } from 'vitest'
import { keyPart, quoteNaming, uploadDocumentFieldsSchema } from './document-add-wire'
import { citationProblems } from './validate'
import { proposedRecordSchema } from './wire'

/** What "Add a document" composes before it calls the services: keys, the quotes KC-6 checks, and the upload's form fields. */

describe('document-add wire', () => {
  test('a key part is lower case, unaccented and dashed', () => {
    expect(keyPart('Ö-Norm B 1600: Barrierefreies Bauen')).toBe('o-norm-b-1600-barrierefreies-bauen')
    expect(keyPart('Straße 2019')).toBe('strasse-2019')
  })

  test('the quote naming a label is words of the document that KC-6 accepts for the record', () => {
    const text = 'Guideline\nRL 1\n\nMechanical resistance and stability\fEdition April 2019 issued by the institute'
    const quote = quoteNaming(text, 'April 2019')
    expect(quote).toContain('April 2019')
    const edition = proposedRecordSchema.parse({ type: 'edition', key: 'e', workKey: 'w', label: 'April 2019', citations: [{ captureId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e', quote }] })
    expect(citationProblems(edition, new Map([['0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e', { text, basis: 'fetched' as const }]]))).toEqual([])
    expect(quoteNaming(text, 'May 2020')).toBeNull()
  })

  test('a label is printed only as whole words: 2019 is not in 12019', () => {
    expect(quoteNaming('Order number 12019 of the ministry for building', '2019')).toBeNull()
    expect(quoteNaming('Order number 12019, edition 2019 of the ministry', '2019')).toContain('edition 2019')
  })

  test('an upload carries its work as JSON, and a broken one is refused', () => {
    const fields = { label: '2024', publishedAt: 'https://publisher.example/x', titleText: 'Fire safety guide 2024', inForceFrom: '' }
    expect(uploadDocumentFieldsSchema.parse({ ...fields, work: '{"workKey":"xx-rl-1"}' })).toMatchObject({ work: { workKey: 'xx-rl-1' }, inForceFrom: null })
    expect(uploadDocumentFieldsSchema.safeParse({ ...fields, work: 'nope' }).success).toBe(false)
  })
})
