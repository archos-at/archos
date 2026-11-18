/**
 * @vitest-environment node
 */

import { describe, expect, test } from 'vitest'
import * as backend from '@/shared/vocabularies.generated'
import {
  DEFAULT_DOC_CLASS,
  DOC_CLASSES,
  DOC_CLASS_LABELS,
  asDocClass,
  docClassAuthority,
  docClassSignal,
  isOibBinding,
  LEGACY_DOC_CLASSES,
} from './doc-class'

describe('doc-class vocabulary parity', () => {
  test('key list + order match backend DOCUMENT_CLASSES', () => {
    expect([...DOC_CLASSES]).toEqual([...backend.DOCUMENT_CLASSES])
  })

  test('German labels match backend DOCUMENT_CLASS_LABELS', () => {
    expect(DOC_CLASS_LABELS).toEqual(backend.DOCUMENT_CLASS_LABELS)
  })

  test('DEFAULT_DOC_CLASS matches backend DEFAULT_DOC_CLASS', () => {
    expect(DEFAULT_DOC_CLASS).toBe(backend.DEFAULT_DOC_CLASS)
  })
})

describe('keys written before the English names', () => {
  test('are the backend LEGACY_DOC_CLASSES, each mapped onto a current class', () => {
    expect(LEGACY_DOC_CLASSES).toEqual(backend.LEGACY_DOC_CLASSES)
    for (const [legacy, current] of Object.entries(backend.LEGACY_DOC_CLASSES)) {
      expect(DOC_CLASSES as readonly string[]).toContain(current)
      expect(asDocClass(legacy)).toBe(current)
    }
  })

  test('a current key and an unknown one narrow as before', () => {
    expect(asDocClass('law')).toBe('law')
    expect(asDocClass('nonsense')).toBeUndefined()
    expect(asDocClass(null)).toBeUndefined()
  })
})

describe('doc-class badge derivation', () => {
  test('every base class tints in the law family', () => {
    for (const dc of DOC_CLASSES) {
      expect(docClassSignal(dc)).toBe('law')
    }
  })

  test('authority tag matches the OIB / RIS / ÖNORM rung', () => {
    expect(docClassAuthority('oib_guideline')).toBe('OIB')
    expect(docClassAuthority('oib_definitions')).toBe('OIB')
    expect(docClassAuthority('external_standard')).toBe('ÖNORM')
    expect(docClassAuthority('law')).toBe('RIS')
  })

  test('isOibBinding is true exactly for the oib_* classes', () => {
    for (const dc of DOC_CLASSES) {
      expect(isOibBinding(dc)).toBe(dc.startsWith('oib_'))
    }
  })

  test('unknown / null values resolve to the neutral default', () => {
    expect(docClassSignal(null)).toBe('law')
    expect(isOibBinding('nonsense')).toBe(false)
  })
})
