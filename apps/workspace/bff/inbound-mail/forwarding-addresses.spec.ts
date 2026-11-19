import { describe, expect, it } from 'vitest'
import {
  forwardingAddressesOf,
  forwardingAddressProblem,
  forwardingListProblem,
  inboundMailForwardedFromBodySchema,
  INBOUND_MAIL_FORWARDED_FROM_MAX,
} from './forwarding-addresses'

const INBOUND = 'inbox.example.org'

describe('an existing project address the office forwards from', () => {
  it('is a plain address, compared lowercase', () => {
    expect(forwardingAddressProblem('Projekt-Kienberg@Buero.at', INBOUND)).toBeNull()
    expect(forwardingAddressesOf([' A@B.at', 'a@b.at', '', '<c@d.at>'])).toEqual(['a@b.at', 'c@d.at'])
  })

  it.each(['kienberg', '@buero.at', 'projekt@', 'projekt@buero', 'a b@buero.at', 'projekt@büro.at', `${'x'.repeat(65)}@buero.at`])(
    'refuses %s',
    (address) => {
      expect(forwardingAddressProblem(address, INBOUND)).toBe('malformed')
    },
  )

  it('is never a project address of ours: forwarding it here would loop', () => {
    expect(forwardingAddressProblem(`project+haus.abcdefgh2345@${INBOUND}`, INBOUND)).toBe('project_address')
    expect(forwardingAddressProblem(`x@mail.${INBOUND}`, INBOUND)).toBe('project_address')
    expect(forwardingAddressProblem(`x@${INBOUND}.buero.at`, INBOUND)).toBeNull()
  })

  it(`holds at most ${INBOUND_MAIL_FORWARDED_FROM_MAX}, counted after duplicates fold`, () => {
    const ten = Array.from({ length: 10 }, (_, n) => `p${n}@buero.at`)
    expect(forwardingListProblem([...ten, 'P0@buero.at'], INBOUND)).toBeNull()
    expect(forwardingListProblem([...ten, 'p10@buero.at'], INBOUND)).toBe('too_many')
    expect(inboundMailForwardedFromBodySchema.safeParse({ forwardedFrom: [...ten, 'p10@buero.at'] }).success).toBe(false)
    expect(inboundMailForwardedFromBodySchema.safeParse({ forwardedFrom: [], extra: 1 }).success).toBe(false)
  })
})
