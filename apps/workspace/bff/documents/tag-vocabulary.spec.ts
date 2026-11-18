import { describe, expect, it } from 'vitest'
import { filesCopy } from '@/i18n/namespaces/files'
import { translatorFor } from '@/i18n/namespace'
import {
  ALLOWED_TAGS,
  DOCUMENT_TYPE_TAGS,
  LABELLED_TAGS,
  areTagsValid,
  documentTypeOf,
  tagLabel,
} from './tag-vocabulary'

describe('tag vocabulary', () => {
  it('lists correspondence as a document type, so it validates, filters and types a document', () => {
    expect(DOCUMENT_TYPE_TAGS).toContain('correspondence')
    expect(ALLOWED_TAGS.has('correspondence')).toBe(true)
    expect(areTagsValid(['correspondence', 'Brandschutz'])).toBe(true)
    expect(documentTypeOf(['Brandschutz', 'correspondence'])).toBe('correspondence')
  })

  it('keeps the old German spelling out: „Korrespondenz“ is a label, never a stored tag', () => {
    expect(ALLOWED_TAGS.has('Korrespondenz')).toBe(false)
  })

  it.each([
    ['de', 'Korrespondenz'],
    ['en', 'Correspondence'],
  ] as const)('reads a token as its %s label', (locale, label) => {
    const t = translatorFor(filesCopy, locale)
    expect(tagLabel('correspondence', t)).toBe(label)
  })

  it('reads every labelled token from every dictionary, and a free topic as itself', () => {
    for (const locale of ['de', 'en'] as const) {
      const t = translatorFor(filesCopy, locale)
      for (const tag of LABELLED_TAGS) {
        expect(tagLabel(tag, t)).not.toBe(`documentTag.${tag}`)
        expect(tagLabel(tag, t)).not.toBe(tag)
      }
      expect(tagLabel('a free topic', t)).toBe('a free topic')
    }
  })

  it('reads a tag still stored in German as itself in German and as its translation in English', () => {
    const german = translatorFor(filesCopy, 'de')
    const english = translatorFor(filesCopy, 'en')
    for (const tag of ALLOWED_TAGS) {
      if (LABELLED_TAGS.includes(tag as (typeof LABELLED_TAGS)[number])) continue
      expect(tagLabel(tag, german)).toBe(tag)
      expect(tagLabel(tag, english)).not.toMatch(/^documentTag\./)
      expect(tagLabel(tag, english)).not.toBe(tag === 'Detail' ? 'never' : tag)
    }
    expect(tagLabel('Grundriss', english)).toBe('Floor plan')
  })
})
