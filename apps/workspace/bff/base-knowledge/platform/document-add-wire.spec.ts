import { describe, expect, test } from 'vitest'
import { guessFromName, keyPart, quoteNaming, uploadDocumentFieldsSchema, type CountryWorkView } from './document-add-wire'
import { citationProblems } from './validate'
import { proposedRecordSchema } from './wire'

/** What "Add a document" composes before it calls the services: keys, the quotes KC-6 checks, and the prefill. */

const WORKS: CountryWorkView[] = [
  { workKey: 'xx-rl-1', title: 'Mechanical resistance', designation: 'RL 1', kind: 'model_code', editions: [] },
  { workKey: 'xx-rl-10', title: 'Something else', designation: 'RL 10', kind: 'model_code', editions: [] },
]

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

  test('the name of a file or URL prefills the work it names (the longest match) and its date or year', () => {
    expect(guessFromName('https://publisher.example/files/rl-10-2023-04-01.pdf?x=1', WORKS)).toMatchObject({ workKey: 'xx-rl-10', label: '2023-04-01' })
    expect(guessFromName('rl-1-2019.pdf', WORKS)).toMatchObject({ workKey: 'xx-rl-1', label: '2019' })
    expect(guessFromName('fire_guide.pdf', WORKS)).toEqual({ workKey: null, label: null, title: 'fire guide' })
  })

  test('an upload carries its work as JSON, and a broken one is refused', () => {
    const fields = { label: '2024', publishedAt: 'https://publisher.example/x', titleText: 'Fire safety guide 2024', inForceFrom: '' }
    expect(uploadDocumentFieldsSchema.parse({ ...fields, work: '{"workKey":"xx-rl-1"}' })).toMatchObject({ work: { workKey: 'xx-rl-1' }, inForceFrom: null })
    expect(uploadDocumentFieldsSchema.safeParse({ ...fields, work: 'nope' }).success).toBe(false)
  })
})
