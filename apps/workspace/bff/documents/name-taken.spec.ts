import { describe, expect, it } from 'vitest'
import { NAME_TAKEN_DETAILS, isNameTakenBody, nameTakenMessage } from './name-taken'

describe('nameTakenMessage', () => {
  it('names the folder, where a name is taken now, and only the name the person typed', () => {
    const message = nameTakenMessage('Plan.pdf')

    expect(message).toBe('A document named "Plan.pdf" is already in this folder. Choose another name.')
    expect(message).not.toMatch(/project/)
  })
})

describe('isNameTakenBody', () => {
  it('recognizes the refusal by its reason, which carries nothing about the document in the way', () => {
    expect(isNameTakenBody({ error: 'x', details: NAME_TAKEN_DETAILS })).toBe(true)
    expect(NAME_TAKEN_DETAILS).toStrictEqual({ reason: 'name_taken' })
  })

  it('is not a name conflict, which the person can answer', () => {
    expect(isNameTakenBody({ details: { reason: 'name_conflict' } })).toBe(false)
    expect(isNameTakenBody(null)).toBe(false)
  })
})
