import { describe, expect, it } from 'vitest'
import {
  documentAliasKey,
  documentNameKey,
  documentNameVariants,
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

  it('does not fold case, because the identity it stands for does not', () => {
    expect(documentNameKey('Plan.pdf')).not.toBe(documentNameKey('plan.pdf'))
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
