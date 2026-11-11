import { describe, expect, it } from 'vitest'
import { addActRecords, actKeyOf } from './law-map-add'
import { proposeRecordsBodySchema } from './wire'

const base = { territoryId: 'XA-1', provision: '§ 1', captureId: '0b8f6d2e-6a51-4d6c-9a0e-4b2f9f1c2d3e', quote: 'the model codes in Edition 2023 are declared binding', validFrom: '2027-07-01' }

describe('addActRecords', () => {
  it('proposes a new act and one binding per work, each citing the clause', () => {
    const records = addActRecords({ ...base, act: { title: 'Technical Ordinance Amendment 2027', designation: 'TO-N 2027' }, editions: [{ workId: 'work:mc-2', editionId: 'edition:mc-2-2023' }, { workId: 'work:mc-10', editionId: 'edition:mc-10-2023' }] })
    expect(records.map((record) => [record.type, 'key' in record ? record.key : null])).toEqual([
      ['work', 'xa-1-to-n-2027'],
      ['relation', 'xa-1-to-n-2027-mc-2-2023-2027-07-01'],
      ['relation', 'xa-1-to-n-2027-mc-10-2023-2027-07-01'],
    ])
    expect(records[1]).toMatchObject({ relationType: 'makes_binding', mode: 'declared', from: { type: 'work', key: 'xa-1-to-n-2027' }, to: { type: 'edition', key: 'mc-2-2023' }, provision: 'TO-N 2027 § 1', validFrom: '2027-07-01' })
    // What it builds is what the propose route takes.
    expect(proposeRecordsBodySchema.safeParse({ records, dryRun: true }).success).toBe(true)
  })

  it('names an act the request holds instead of proposing it again', () => {
    const input = { ...base, act: { workKey: 'to-n' }, editions: [{ workId: 'work:mc-2', editionId: 'edition:mc-2-2023' }] }
    expect(actKeyOf(input)).toBe('to-n')
    expect(addActRecords(input).map((record) => record.type)).toEqual(['relation'])
  })
})
