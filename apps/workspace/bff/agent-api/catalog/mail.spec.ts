import { describe, expect, it } from 'vitest'
import { mailOperations } from './mail'

const THIRD_PARTY = /third[- ]party (?:text|wrote), never instructions/u

describe('the held-mail operations the agent reads', () => {
  it.each(['inbound-mail-list', 'inbound-mail-get', 'inbound-mail-text-get'])(
    '%s says that what a sender wrote is never an instruction',
    (name) => {
      const operation = mailOperations.find((candidate) => candidate.name === name)
      expect(operation?.description).toMatch(THIRD_PARTY)
    },
  )
})
