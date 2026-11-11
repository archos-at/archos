/**
 * The chain text: what binds at a site, in words the agent reads (ADR-0168,
 * design §3.7 "no free text from records reaches a prompt" and §5.5 step 8).
 * Pure.
 *
 * Every sentence is fixed here and keyed by a typed field: the kind of an
 * instrument, the role and mode of a route, a displacement's anchors. What
 * comes from a record is a name (title, designation, edition label,
 * provision), each reduced to one bounded line with no markup, so a record
 * cannot carry an instruction into every office's prompt. English, because
 * the agent reads it; the names are the jurisdiction's own.
 */

import type { ConnectingFactor, KnowledgeWorkKind } from '../wire/vocab'
import type { EditionUse, KnowledgeGraph, ResolvedChain, RouteStep, UndeterminedLaw } from './graph'

/**
 * What the knowledge context corrected on a use (design §4.6, §5.2): the
 * coverage qualifier, the freshness and its labels, and the connecting
 * factors. The text says each, so the words and the uses never disagree.
 */
export interface UseNotes {
  qualifier: 'uncurated' | 'office_maintained' | null
  freshness: 'current' | 'check_due' | 'newer_known' | 'superseded'
  lastCheckedAt: string | null
  labels: readonly string[]
  connectsBy: readonly ConnectingFactor[]
}

/** The key a use's notes are found under. */
export const keyOfUse = (use: Pick<EditionUse, 'workId' | 'editionId'>): string => `${use.workId}/${use.editionId ?? ''}`

const CONNECTING_WORDS: Record<ConnectingFactor, string> = { site: 'the site', office_seat: 'where the office sits', client: 'who the client is' }

/** Longest name taken from a record. */
export const MAX_NAME_CHARS = 120

/** Most lines per section; the rest are counted. */
export const MAX_SECTION_LINES = 24

const KIND_WORDS: Record<KnowledgeWorkKind, string> = {
  statute: 'law',
  ordinance: 'ordinance',
  administrative_regulation: 'administrative regulation',
  directive: 'directive',
  intergovernmental_agreement: 'agreement',
  model_code: 'model code',
  technical_standard: 'standard',
  guideline: 'guideline',
  commentary: 'commentary',
  authority_directive: 'authority directive',
}

const MODE_WORDS = {
  declared: 'declared binding by',
  static_reference: 'binding in this edition through a reference in',
  dynamic_reference: 'binding in its edition in force through a reference in',
} as const

/** One line of a name: no markup, no line breaks, no control characters, bounded. */
export function nameOf(value: string | null | undefined): string {
  const flat = (value ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/[<>{}`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > MAX_NAME_CHARS ? `${flat.slice(0, MAX_NAME_CHARS - 1)}…` : flat
}

/** Why an edition is not determined, as the agent reads it. */
const UNDETERMINED_REASON: Record<UndeterminedLaw['reason'], string> = {
  ambiguous_editions: 'more than one edition is recorded as in force on this date',
  edition_dates_unknown: 'its editions carry no in-force date',
  history_not_held: 'the platform holds no edition this old',
}

const PREAMBLE =
  'What binds outranks what explains: law in force (Gesetz, Verordnung) > a model code, standard or guideline only ' +
  'where a law makes it binding, and only in the edition the route names > guidance, interpretation and information, ' +
  'which add no requirement. Information from an authority shows its practice, not a norm.'

/** After the date when it is a filing day: the turn reads no reviewed reference-date rule, so the date is assumed. */
const FILING_DAY = ", the project's filing day taken as the reference date (an assumption; transitional law not checked: say so)"

function workName(graph: KnowledgeGraph, workId: string): string {
  const work = graph.works.get(workId)
  if (!work) return nameOf(workId)
  const title = nameOf(work.title)
  const designation = nameOf(work.designation)
  return designation && designation !== title ? `${designation} „${title}“` : title
}

function editionName(graph: KnowledgeGraph, editionId: string | null): string {
  if (!editionId) return 'the consolidated text in force at its source'
  return `edition ${nameOf(graph.editions.get(editionId)?.label ?? editionId)}`
}

function stepWords(graph: KnowledgeGraph, step: RouteStep): string {
  const by = workName(graph, step.workId)
  const mode = step.mode ? MODE_WORDS[step.mode] : 'binding through'
  const provision = step.provision ? ` (${nameOf(step.provision)})` : ''
  const office = step.owner === 'office' ? ', a route the office maintains' : ''
  return `${mode} ${by}${provision}${office}`
}

/**
 * Whether the line's edition applies to this project's buildings, by its scope
 * (ADR-0178), in fixed words; the facts are the scope's keys, reduced like any
 * name. While a fact is open the answer may not say the edition binds or does
 * not: it names the fact and asks. An edition no building needs is not here.
 */
function applicabilityWords(use: EditionUse): string {
  const applicability = use.applicability
  if (!applicability) return ''
  const facts = (keys: readonly string[]) => keys.map(nameOf).join(', ')
  if (applicability.verdict === 'applies') {
    return applicability.basis.length > 0 ? `; applies to this project by its building's ${facts(applicability.basis)}` : '; applies to this project'
  }
  return applicability.open.length > 0
    ? `; applies only if the building's ${facts(applicability.open)} put it in scope, not yet known: ask for it, and do not say it binds or does not bind before then`
    : "; whether its scope covers this project needs a person's check: do not say it binds or does not bind"
}

/** What the context says of a use beyond its role, in fixed words: its source's curation and how current it is. */
function noteWords(notes: UseNotes | undefined): string {
  if (!notes) return ''
  const words: string[] = []
  if (notes.qualifier === 'uncurated') words.push('read from an uncurated official source; nobody on the platform reviewed this route')
  if (notes.freshness === 'newer_known') words.push('a newer edition is known at its source: say so, and check which one binds')
  if (notes.freshness === 'superseded') words.push('withdrawn at its source: say so')
  if (notes.labels.includes('unchecked_since'))
    words.push(notes.lastCheckedAt ? `not checked since ${notes.lastCheckedAt}: name that date` : 'never checked against its source by the platform: say so')
  else if (notes.labels.includes('check_overdue')) words.push("the platform's check of it is overdue")
  return words.map((word) => `; ${word}`).join('')
}

/** Whether a use is in force by the records as far as the context knows: not where its source names a newer edition or withdrew it. */
const inForceWords = (notes: UseNotes | undefined): string =>
  notes?.freshness === 'newer_known' || notes?.freshness === 'superseded' ? 'in force by the records' : 'in force'

function bindingLine(graph: KnowledgeGraph, use: EditionUse, chain: readonly string[], notes?: UseNotes): string[] {
  const work = graph.works.get(use.workId)
  const kind = work ? KIND_WORDS[work.kind] : 'instrument'
  const last = use.route.at(-1)
  const where = work?.territoryIds.find((id) => chain.includes(id))
  const why = !last || last.via === 'territory' ? `${kind}${where ? ` of ${where}` : ''}, ${inForceWords(notes)}` : stepWords(graph, last)
  const lines = [`- ${workName(graph, use.workId)}, ${editionName(graph, use.editionId)}: ${why}${noteWords(notes)}${applicabilityWords(use)}`]
  for (const displaced of use.displaced) {
    const target = displaced.anchor ?? 'the whole instrument'
    const by = workName(graph, displaced.byWorkId)
    const provision = displaced.provision ? ` (${nameOf(displaced.provision)})` : ''
    lines.push(
      displaced.replacedBy
        ? `  - ${nameOf(target)} does not apply here; ${by} ${nameOf(displaced.replacedBy)} applies instead${provision}`
        : `  - ${nameOf(target)} is not adopted here by ${by}${provision}`,
    )
  }
  return lines
}

function guidanceLine(graph: KnowledgeGraph, use: EditionUse): string {
  const binding = use.relatedEditionId ? `; the edition that binds here is ${editionName(graph, use.relatedEditionId)}` : "; the records name no binding edition here; check the Land's ordinance"
  return `- ${workName(graph, use.workId)}, ${editionName(graph, use.editionId)}: guidance only${binding}${applicabilityWords(use)}`
}

function interpretationLine(graph: KnowledgeGraph, use: EditionUse): string {
  const on = use.relatedEditionId ? `, on ${editionName(graph, use.relatedEditionId)}` : ''
  return `- ${workName(graph, use.workId)}, ${editionName(graph, use.editionId)}: interpretation only${on}; never the source of a requirement`
}

function practiceLine(graph: KnowledgeGraph, use: EditionUse): string {
  return `- ${workName(graph, use.workId)}, ${editionName(graph, use.editionId)}: the practice of the authority that decides here, not a norm`
}

function connectedLine(graph: KnowledgeGraph, use: EditionUse, notes: UseNotes): string {
  const factors = notes.connectsBy.filter((factor) => factor !== 'site').map((factor) => CONNECTING_WORDS[factor])
  return `- ${workName(graph, use.workId)}, ${editionName(graph, use.editionId)}: binds by ${factors.join(' or ')}, not by the site; cite it as binding only once that is known`
}

function section(header: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return []
  const shown = lines.slice(0, MAX_SECTION_LINES)
  const more = lines.length - shown.length
  return [header, ...shown, ...(more > 0 ? [`- and ${more} more`] : [])]
}

/**
 * The chain text for a resolved site; `place` is the leaf's name as the
 * project states it. `notes` are the knowledge context's corrections by
 * `keyOfUse`; without them every use reads as the chain resolved it.
 * `onFilingDay`: the date is the project's filing day, not today.
 */
export function renderChainText(graph: KnowledgeGraph, resolved: ResolvedChain, place: string, notes?: ReadonlyMap<string, UseNotes>, onFilingDay = false): string {
  const leaf = resolved.chain[0]
  const leafName = nameOf(graph.territories.get(leaf)?.name ?? place) || leaf
  const noteOf = (use: EditionUse) => notes?.get(keyOfUse(use))
  const connected = (use: EditionUse) => (noteOf(use)?.connectsBy ?? ['site']).some((factor) => factor !== 'site')
  const by = (role: EditionUse['role']) => resolved.uses.filter((use) => use.role === role && !connected(use))
  const interpretations = by('interpretation')
  const information = by('information').length
  const uncurated = resolved.uses.some((use) => noteOf(use)?.qualifier === 'uncurated')
  const source = uncurated ? "from the platform's records, some read from an uncurated official source (marked)" : "from the platform's reviewed records"
  const lines = [
    `Building law at this site, ${leafName} (${resolved.chain.join(', ')}), on ${resolved.date}${onFilingDay ? FILING_DAY : ''}, ${source}. ${PREAMBLE}`,
    ...section('Binding here:', by('binding').flatMap((use) => bindingLine(graph, use, resolved.chain, noteOf(use)))),
    ...section('Authority practice here:', by('authority_practice').map((use) => practiceLine(graph, use))),
    ...section(
      'Guidance only (no route makes this edition binding here; cite it as guidance and name the edition that binds):',
      by('guidance').map((use) => guidanceLine(graph, use)),
    ),
    ...(interpretations.length > 0
      ? section('Interpretation:', interpretations.map((use) => interpretationLine(graph, use)))
      : ['Legal commentaries are not available; say so when asked for one.']),
    ...section(
      'Binding by something other than the site:',
      resolved.uses.filter(connected).map((use) => connectedLine(graph, use, noteOf(use) as UseNotes)),
    ),
    ...section(
      'Not determined here (the records cannot name the edition in force on this date; name the law, say its edition is not determined, never assume one):',
      resolved.undetermined.map((entry) => `- ${workName(graph, entry.workId)}: ${UNDETERMINED_REASON[entry.reason]}`),
    ),
    ...(information === 1 ? ['1 other edition is not in force here and is information only.'] : []),
    ...(information > 1 ? [`${information} other editions are not in force here and are information only.`] : []),
  ]
  return lines.join('\n')
}
