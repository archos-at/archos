/**
 * @vitest-environment node
 *
 * A territory's body (migration 0219): `parents` is the one claim, and the two
 * lists before it are written beside it, derived, so a build older than 0219
 * reads the same parents until the contract migration drops them.
 */

import { describe, expect, it } from 'vitest'
import { bodyOf, claimsOf } from './records'
import { proposedRecordSchema } from './wire'

describe('a territory body', () => {
  const austria = proposedRecordSchema.parse({
    type: 'territory',
    id: 'AT',
    kind: 'country',
    name: 'Österreich',
    parents: [{ id: 'EU', validFrom: '1995-01-01' }],
  })
  const vienna = proposedRecordSchema.parse({ type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parents: [{ id: 'AT' }] })

  it('writes the older builds’ parent_ids and dated_parents from parents', () => {
    expect(bodyOf(vienna)).toMatchObject({ parents: [{ id: 'AT', validFrom: null, validTo: null }], parentIds: ['AT'], datedParents: [] })
    expect(bodyOf(austria)).toMatchObject({ parentIds: [], datedParents: [{ id: 'EU', validFrom: '1995-01-01', validTo: null }] })
  })

  it('offers a reviewer parents as the one claim, never the derived lists', () => {
    const paths = claimsOf(bodyOf(austria)).map((claim) => claim.path)
    expect(paths).toContain('parents')
    expect(paths).not.toContain('parentIds')
    expect(paths).not.toContain('datedParents')
  })

  it('reads a stored body without a stated zone as no claim, and a stated one as a claim (0235)', () => {
    // A body stored before 0235 reads back with `zone: null`: no claim a reviewer still owes a verdict on.
    expect(claimsOf({ ...bodyOf(austria), zone: null }).map((claim) => claim.path)).not.toContain('zone')
    const zoned = proposedRecordSchema.parse({ type: 'territory', id: 'XA', kind: 'country', name: 'Xanadu', zone: 'Asia/Tokyo' })
    expect(claimsOf(bodyOf(zoned))).toContainEqual({ path: 'zone', value: 'Asia/Tokyo' })
  })

  it('refuses the old fields rather than dropping them silently', () => {
    expect(proposedRecordSchema.safeParse({ type: 'territory', id: 'AT-9', kind: 'state', name: 'Wien', parentIds: ['AT'] }).success).toBe(false)
  })
})
