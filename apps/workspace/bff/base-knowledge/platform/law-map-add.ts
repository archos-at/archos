import type { z } from 'zod'
import { keyPart } from './document-add-wire'
import type { proposeRecordsBodySchema } from './wire'

export interface AddActInput {
  territoryId: string
  act: { workKey: string } | { title: string; designation: string | null; kind: 'ordinance' | 'statute'; namedBy: string }
  provision: string | null
  captureId: string
  quote: string
  validFrom: string
  editions: { workId: string; editionId: string }[]
}

type ProposedRecord = z.input<typeof proposeRecordsBodySchema>['records'][number]

const keyOf = (recordId: string): string => recordId.replace(/^[a-z_]+:/, '')

export function actKeyOf(input: AddActInput): string {
  if ('workKey' in input.act) return input.act.workKey
  return `${keyPart(input.territoryId, 12)}-${keyPart(input.act.designation ?? input.act.title, 60)}`
}

function fingerprint(text: string): string {
  let hash = 5381
  for (const char of text) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  return hash.toString(16).padStart(8, '0')
}

export function relationKey(actKey: string, editionKey: string, validFrom: string): string {
  const full = `${actKey}-${editionKey}-${validFrom}`
  return full.length <= 100 ? full : `${full.slice(0, 90)}-${fingerprint(full)}`
}

export function addActRecords(input: AddActInput): ProposedRecord[] {
  const actKey = actKeyOf(input)
  const citations = [{ captureId: input.captureId, quote: input.quote }]
  const designation = 'workKey' in input.act ? null : input.act.designation
  const provision = input.provision ? [designation, input.provision].filter(Boolean).join(' ').slice(0, 120) : designation
  const act: ProposedRecord[] =
    'workKey' in input.act
      ? []
      : [{ type: 'work', key: actKey, kind: input.act.kind, title: input.act.title, designation, territoryIds: [input.territoryId], citations: [{ captureId: input.captureId, quote: input.act.namedBy }, ...citations] }]
  const relations: ProposedRecord[] = input.editions.map(({ editionId }) => ({
    type: 'relation',
    key: relationKey(actKey, keyOf(editionId), input.validFrom),
    relationType: 'makes_binding',
    mode: 'declared',
    from: { type: 'work', key: actKey },
    to: { type: 'edition', key: keyOf(editionId) },
    provision,
    validFrom: input.validFrom,
    citations,
  }))
  return [...act, ...relations]
}
