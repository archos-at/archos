/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  INBOUND_MAIL_ADDRESS_LIMIT,
  INBOUND_MAIL_ORGANIZATION_LIMIT,
  INBOUND_MAIL_SIGNING_KEY_LIMIT,
} from './catalog'
import { consumeLimit } from './enforce'
import { createInProcessStore, setLimitStore } from './store'

const KEY = 'keyid:worker-1'

const OFFICES_AT_FULL_CAP = 100

async function deliver(
  organizationId: string,
  addressId: string,
  cost = 1
): Promise<string | null> {
  const rules = [
    [INBOUND_MAIL_ADDRESS_LIMIT, `${organizationId}:${addressId}`],
    [INBOUND_MAIL_ORGANIZATION_LIMIT, organizationId],
    [INBOUND_MAIL_SIGNING_KEY_LIMIT, KEY],
  ] as const
  for (const [rule, subject] of rules) {
    if (!(await consumeLimit(rule, subject, cost)).allowed) return rule.name
  }
  return null
}

beforeEach(() => {
  setLimitStore(createInProcessStore())
})

afterEach(() => {
  setLimitStore(null)
})

describe('inbound mail limits', () => {
  it('one office at its cap is refused at its own bucket and another office still receives', async () => {
    const perAddress = INBOUND_MAIL_ADDRESS_LIMIT.limit
    const addresses = INBOUND_MAIL_ORGANIZATION_LIMIT.limit / perAddress
    for (let address = 0; address < addresses; address++) {
      expect(await deliver('org-flood', `addr-${address}`, perAddress)).toBeNull()
    }

    expect(await deliver('org-flood', 'addr-next')).toBe(INBOUND_MAIL_ORGANIZATION_LIMIT.name)
    expect(await deliver('org-quiet', 'addr-0')).toBeNull()
  })

  it(`the shared ceiling holds ${OFFICES_AT_FULL_CAP} offices at their full cap at once`, async () => {
    const cap = INBOUND_MAIL_ORGANIZATION_LIMIT.limit
    for (let office = 0; office < OFFICES_AT_FULL_CAP; office++) {
      expect(
        (await consumeLimit(INBOUND_MAIL_ORGANIZATION_LIMIT, `org-${office}`, cap)).allowed
      ).toBe(true)
      expect((await consumeLimit(INBOUND_MAIL_SIGNING_KEY_LIMIT, KEY, cap)).allowed).toBe(true)
      expect(await deliver(`org-${office}`, 'addr-0')).toBe(INBOUND_MAIL_ORGANIZATION_LIMIT.name)
    }
  })
})
