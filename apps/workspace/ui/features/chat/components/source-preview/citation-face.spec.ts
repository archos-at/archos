import { describe, expect, it } from 'vitest'
import { faceClasses } from './citation-face'

describe('a source chip under an answer', () => {
  it('truncates only at the width of its row, not at a fixed 224px', () => {
    const classes = faceClasses('chip').split(/\s+/)
    expect(classes).toContain('max-w-full')
    expect(classes.filter((name) => /^max-w-(?!full$)/.test(name))).toEqual([])
  })
})
