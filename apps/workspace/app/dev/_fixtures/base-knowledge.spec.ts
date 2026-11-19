import { describe, expect, it } from 'vitest'

import { BASE_KNOWLEDGE_ENTRIES } from './base-knowledge'

const editionDay = (label: string): string | null => label.match(/\d{4}(-\d{2}(-\d{2})?)?/)?.[0] ?? null

describe('the base-knowledge preview entries', () => {
  it.each(BASE_KNOWLEDGE_ENTRIES.map((entry) => [entry.values.designation ?? entry.values.title, entry] as const))(
    '%s starts no earlier than its own edition',
    (_name, entry) => {
      const edition = editionDay(entry.values.editionLabel)
      for (const startsOn of [entry.values.inForceFrom ?? entry.values.issuedOn, ...entry.editions.filter((own) => own.id === entry.id).map((own) => own.startsOn)]) {
        if (!startsOn || !edition) continue
        expect(startsOn.slice(0, edition.length) >= edition).toBe(true)
      }
    },
  )
})
