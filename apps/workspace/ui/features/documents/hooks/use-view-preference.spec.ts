import { describe, expect, it } from 'vitest'
import { LIST_VIEW_ABOVE, fileViewFor } from './use-view-preference'

describe('fileViewFor', () => {
  it('opens a level of up to fifty documents as tiles and a larger one as the list', () => {
    expect(fileViewFor(null, 7)).toBe('cards')
    expect(fileViewFor(null, LIST_VIEW_ABOVE)).toBe('cards')
    expect(fileViewFor(null, LIST_VIEW_ABOVE + 1)).toBe('list')
  })

  it('keeps the reader’s own choice, whatever the level holds', () => {
    expect(fileViewFor('cards', 500)).toBe('cards')
    expect(fileViewFor('list', 3)).toBe('list')
  })
})
