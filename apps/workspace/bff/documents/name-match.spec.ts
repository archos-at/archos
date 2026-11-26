import { describe, expect, it } from 'vitest'
import {
  documentAliasKey,
  documentNameKey,
  documentNameMatchKey,
  documentNameVariants,
  heldDocumentName,
  holdsDocumentName,
  originBaseName,
} from './name-match'

const COMPOSED = 'Pr\u00fcfbericht.pdf'
const DECOMPOSED = 'Pru\u0308fbericht.pdf'

describe('documentNameKey', () => {
  it('is the same key for the two Unicode spellings of one name', () => {
    expect(COMPOSED).not.toBe(DECOMPOSED)
    expect(documentNameKey(DECOMPOSED)).toBe(documentNameKey(COMPOSED))
  })

  it('settles on the composed form, which is what everything but macOS produces', () => {
    expect(documentNameKey(DECOMPOSED)).toBe(COMPOSED)
  })

  it('drops the whitespace a file manager leaves and nobody can see', () => {
    expect(documentNameKey('  Plan.pdf ')).toBe('Plan.pdf')
  })

  it('keeps the case a person typed, because it is the spelling a document is stored under', () => {
    expect(documentNameKey('Plan.pdf')).toBe('Plan.pdf')
    expect(documentNameKey('plan.pdf')).toBe('plan.pdf')
  })
})

describe('documentNameMatchKey', () => {
  it('compares as the Finder does: one key for every case, Unicode form and stray whitespace of a name', () => {
    expect(documentNameMatchKey('Plan.pdf')).toBe(documentNameMatchKey('plan.PDF'))
    expect(documentNameMatchKey(` ${DECOMPOSED.toUpperCase()}`)).toBe(documentNameMatchKey(COMPOSED))
  })

  it('folds the case of letters beyond ASCII, which a database under the C locale does not', () => {
    expect(documentNameMatchKey('Übersicht.pdf')).toBe(documentNameMatchKey('übersicht.pdf'))
  })

  it('keeps different names apart', () => {
    expect(documentNameMatchKey('Plan 2.pdf')).not.toBe(documentNameMatchKey('Plan.pdf'))
  })
})

describe('holdsDocumentName', () => {
  it('is held under the name it was stored as and under the name it was renamed to', () => {
    const renamed = { filename: 'scan_0001.pdf', displayName: 'Lageplan.pdf' }
    expect(holdsDocumentName(renamed, 'SCAN_0001.pdf')).toBe(true)
    expect(holdsDocumentName(renamed, 'lageplan.pdf')).toBe(true)
    expect(holdsDocumentName(renamed, 'Plan.pdf')).toBe(false)
  })

  it('answers the spelling the document holds the name in', () => {
    const renamed = { filename: 'scan_0001.pdf', displayName: 'Lageplan.pdf' }
    expect(heldDocumentName(renamed, 'LAGEPLAN.pdf')).toBe('Lageplan.pdf')
    expect(heldDocumentName(renamed, 'Scan_0001.PDF')).toBe('scan_0001.pdf')
    expect(heldDocumentName(renamed, 'Plan.pdf')).toBeNull()
  })

  it('holds only its filename when nobody renamed it', () => {
    expect(holdsDocumentName({ filename: 'Plan.pdf', displayName: null }, 'plan.pdf')).toBe(true)
    expect(holdsDocumentName({ filename: 'Plan.pdf' }, '')).toBe(false)
  })
})

describe('documentNameVariants', () => {
  it('offers both spellings, so a row written before the key existed is still found', () => {
    expect(documentNameVariants(DECOMPOSED)).toEqual([COMPOSED, DECOMPOSED])
  })

  it('offers one candidate when the name has no second spelling', () => {
    expect(documentNameVariants('Plan.pdf')).toEqual(['Plan.pdf'])
  })
})

describe('documentAliasKey', () => {
  it('recognizes a name that differs only in case', () => {
    expect(documentAliasKey('DECKBLATT.pdf')).toBe(documentAliasKey('Deckblatt.pdf'))
  })

  it('recognizes across Unicode spellings too', () => {
    expect(documentAliasKey(DECOMPOSED.toUpperCase())).toBe(documentAliasKey(COMPOSED))
  })
})

describe('originBaseName', () => {
  it('is the filename out of the path a folder upload recorded', () => {
    expect(originBaseName('Wohnbau Nord/03_Einreichung/EG.pdf')).toBe('EG.pdf')
  })

  it('handles a Windows path, which is what a Windows office server hands over', () => {
    expect(originBaseName('Wohnbau\\Statik\\EG.pdf')).toBe('EG.pdf')
  })

  it('is null when there is no path and when the path names nothing', () => {
    expect(originBaseName(null)).toBeNull()
    expect(originBaseName('')).toBeNull()
    expect(originBaseName('///')).toBeNull()
  })
})
