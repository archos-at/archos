import { describe, expect, it } from 'vitest'
import { documentNameMatchKey } from './name-match'
import { nextFreeDocumentName } from './next-free-name'

const taken = (...names: string[]) => new Set(names.map(documentNameMatchKey))

describe('nextFreeDocumentName', () => {
  it('numbers a name from 2', () => {
    expect(nextFreeDocumentName('Plan.pdf', taken('Plan.pdf'))).toBe('Plan 2.pdf')
  })

  it('bumps the trailing number of a numbered name instead of adding a second one', () => {
    expect(nextFreeDocumentName('Plan 2.pdf', taken('Plan.pdf', 'Plan 2.pdf'))).toBe('Plan 3.pdf')
    expect(nextFreeDocumentName('PLAN 2.MD', taken('PLAN 2.MD'))).toBe('PLAN 3.MD')
  })

  it('skips the numbers the folder already holds, in any case', () => {
    expect(nextFreeDocumentName('Plan 2.pdf', taken('Plan 2.pdf', 'plan 3.PDF'))).toBe('Plan 4.pdf')
  })

  it('leaves a year or a zero-padded number in the name and numbers after it', () => {
    expect(nextFreeDocumentName('Bestand 2024.pdf', taken('Bestand 2024.pdf'))).toBe('Bestand 2024 2.pdf')
    expect(nextFreeDocumentName('Plan 01.pdf', taken('Plan 01.pdf'))).toBe('Plan 01 2.pdf')
  })

  it('numbers a name without an extension', () => {
    expect(nextFreeDocumentName('Plan 2', taken('Plan 2'))).toBe('Plan 3')
  })
})
