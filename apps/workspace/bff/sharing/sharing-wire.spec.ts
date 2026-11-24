import { describe, expect, it } from 'vitest'
import { confirmedByThePerson } from './sharing-wire'

describe('confirmedByThePerson: only the person confirms sharing personal content (ADR-0191 rule 5)', () => {
  it('takes the person’s own confirmation', () => {
    expect(confirmedByThePerson(true, false)).toBe(true)
  })

  it('never takes one the agent sends while acting for the person', () => {
    expect(confirmedByThePerson(true, true)).toBe(false)
  })

  it('is no confirmation when none was given', () => {
    expect(confirmedByThePerson(undefined, false)).toBe(false)
  })
})
