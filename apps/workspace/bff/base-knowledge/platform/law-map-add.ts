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
  /**
   * An act already on record, by its work key, or a new one by its printed title, its kind, and the words on the
   * page that name it: KC-6 holds a work to a quote naming its designation (else its title).
   */
  act: { workKey: string } | { title: string; designation: string | null; kind: 'ordinance' | 'statute'; namedBy: string }
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

/** A short stable fingerprint, so a long act key never cuts off the edition or the day that tell two bindings apart. */
function fingerprint(text: string): string {
  let hash = 5381
  for (const char of text) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  return hash.toString(16).padStart(8, '0')
}

/** One key per act, edition and day, within the key's 100 characters. */
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
