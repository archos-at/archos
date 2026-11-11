/**
 * What "+ Add an act" in the law map proposes (country-onboarding-ux.md, B):
 * the act itself when it is new, and one `makes_binding` relation per work it
 * adopts, each citing the captured gazette page with the clause the person
 * copied from it. The records go through the existing propose route into the
 * country's draft request, a dry run first; the kit decides whether they hold.
 * Pure.
 */

import type { z } from 'zod'
import { keyPart } from './document-add-wire'
import type { proposeRecordsBodySchema } from './wire'

export interface AddActInput {
  territoryId: string
  /** An act the request already holds, by its work key, or a new one by its printed title. */
  act: { workKey: string } | { title: string; designation: string | null }
  /** Where the act says so, e.g. "§ 1"; prefixed with the act's designation when it has one. */
  provision: string | null
  captureId: string
  /** The adopting clause, copied exactly from the captured page. */
  quote: string
  validFrom: string
  /** The edition each work binds in from that day, by edition record id (`edition:<key>`). */
  editions: { workId: string; editionId: string }[]
}

type ProposedRecord = z.input<typeof proposeRecordsBodySchema>['records'][number]

const keyOf = (recordId: string): string => recordId.replace(/^[a-z_]+:/, '')

/** The act's work key: the one named, or one made from the new act's designation or title and its region. */
export function actKeyOf(input: AddActInput): string {
  if ('workKey' in input.act) return input.act.workKey
  return `${keyPart(input.territoryId, 12)}-${keyPart(input.act.designation ?? input.act.title, 60)}`
}

export function addActRecords(input: AddActInput): ProposedRecord[] {
  const actKey = actKeyOf(input)
  const citations = [{ captureId: input.captureId, quote: input.quote }]
  const designation = 'workKey' in input.act ? null : input.act.designation
  const provision = input.provision ? [designation, input.provision].filter(Boolean).join(' ').slice(0, 120) : designation
  const act: ProposedRecord[] =
    'workKey' in input.act ? [] : [{ type: 'work', key: actKey, kind: 'ordinance', title: input.act.title, designation, territoryIds: [input.territoryId], citations }]
  const relations: ProposedRecord[] = input.editions.map(({ editionId }) => ({
    type: 'relation',
    key: `${actKey}-${keyOf(editionId)}-${input.validFrom}`.slice(0, 100),
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
