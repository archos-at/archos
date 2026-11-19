import { ASK_FOR_LICENCE, type BaseKnowledgeEntry } from '../wire'
import type { ListedEdition, PlatformDirective } from '../platform'
import { directiveApplicability, type ProjectTerritory } from './authority'

export const MAX_TURN_ENTRIES = 40

export const MAX_TURN_LINE_CHARS = 400

export const MAX_TURN_BLOCK_CHARS = 17_000

const MORE_LINE_RESERVE = 48

export const BASE_KNOWLEDGE_HEADER =
  "The office's own base knowledge: copies it holds in its Archiv (the Büroablage), for this office only; find a passage " +
  'by searching the Archiv for the file. When an answer rests on one, name its designation or title, its edition and when it was last ' +
  'checked; when the check is overdue, say so in the answer. The role decides what a passage can carry: ' +
  '"requirement source" may ground a requirement; "interpretation only" may explain a provision but never be cited ' +
  'as the source of a requirement; "authority practice" counts only where it says it applies, and when the authority ' +
  'is unknown, say that you could not tell whether the directive applies.'

export const UNATTESTED_RULE =
  'An entry marked LISTED ONLY, NOT READ has no passages to find: say the office holds that file, and that you may not ' +
  'read it until the office attests its licence for AI processing; answer the rest from other sources.'

const KIND_WORDS: Record<BaseKnowledgeEntry['values']['kind'], string> = {
  technical_standard: 'technical standard',
  guideline: 'guideline',
  commentary: 'commentary',
  authority_directive: 'authority directive',
  statute: 'law',
}

function role(entry: BaseKnowledgeEntry, project: ProjectTerritory): string {
  const { kind, addressees } = entry.values
  if (kind === 'commentary') return 'interpretation only'
  if (kind !== 'authority_directive') return 'requirement source where a law makes it binding'
  const names = addressees.map((addressee) => addressee.name).join(', ') || 'no authority recorded'
  const verdict = directiveApplicability(addressees, project)
  if (verdict.verdict === 'applies') {
    return `authority practice of ${names}; applies to this project (authority taken from the project's details, ${verdict.territoryId}, not verified)`
  }
  if (verdict.verdict === 'does_not_apply') {
    return `authority practice of ${names}; does NOT apply to this project (project in ${verdict.territoryId})`
  }
  return `authority practice of ${names}; authority unknown for this project (its Land is not recorded), so do not apply it as settled`
}

function checkWords(entry: BaseKnowledgeEntry): string {
  const { lastCheck, overdue, intervalDays } = entry.freshness
  if (!lastCheck) return `never checked; overdue`
  const day = lastCheck.checkedAt.slice(0, 10)
  const found = lastCheck.result === 'current' ? 'current' : lastCheck.result.replace('_', ' ')
  return overdue
    ? `last checked ${day} (${found}); check OVERDUE (due every ${intervalDays} days), say so`
    : `last checked ${day} (${found})`
}

function bindingWords(binding: NonNullable<BaseKnowledgeEntry['binding']>, on: string): string {
  const by = [binding.via?.designation, binding.via?.editionLabel].filter(Boolean).join(' ')
  return `${OTHER_EDITION_BINDING} on ${on}: edition ${binding.editionLabel}${by ? `, made binding by ${by}` : ''}`
}

function line(entry: BaseKnowledgeEntry, project: ProjectTerritory, on: string): string {
  const { values, binding } = entry
  const other = binding && !binding.held ? binding : null
  const titled = `„${values.title}“`
  const name = values.designation ? (other ? values.designation : `${values.designation} ${titled}`) : titled
  const parts = [
    `${name}: ${KIND_WORDS[values.kind]}, edition ${values.editionLabel}`,
    other ? bindingWords(other, on) : null,
    `role: ${role(entry, project)}`,
    `file „${entry.fileName}“`,
    ASK_FOR_LICENCE && entry.textUse === 'metadata_only' ? UNATTESTED : null,
    ASK_FOR_LICENCE && entry.textUse === 'used' && values.licenceClass === 'licensed' ? 'licensed copy' : null,
    binding?.held ? `the edition binding on ${on}` : checkWords(entry),
    other && values.designation ? `title ${titled}` : null,
  ].filter(Boolean)
  const text = `- ${parts.join('; ')}`
  return text.length > MAX_TURN_LINE_CHARS ? `${text.slice(0, MAX_TURN_LINE_CHARS - 1)}…` : text
}

const UNATTESTED = 'LISTED ONLY, NOT READ: its licence is not attested for AI processing; say so, and do not quote or paraphrase it'

function unreadLine(entry: BaseKnowledgeEntry): string {
  const { values } = entry
  const name = values.designation ? `${values.designation} „${values.title}“` : `„${values.title}“`
  const text = `- ${name}: ${KIND_WORDS[values.kind]}, edition ${values.editionLabel}; file „${entry.fileName}“; licensed copy, not yet confirmed; ${UNATTESTED}`
  return text.length > MAX_TURN_LINE_CHARS ? `${text.slice(0, MAX_TURN_LINE_CHARS - 1)}…` : text
}

function listedLine(listed: ListedEdition): string {
  const name = `${listed.designation} „${listed.title}“`
  const result = `- ${name}: listed by the platform, edition ${listed.editionLabel}; the platform holds its text`
  return result.length > MAX_TURN_LINE_CHARS ? `${result.slice(0, MAX_TURN_LINE_CHARS - 1)}…` : result
}

function directiveLine(directive: PlatformDirective): string {
  const name = directive.designation ? `${directive.designation} „${directive.title}“` : `„${directive.title}“`
  const of = directive.authorities.join(', ') || 'no authority recorded'
  const edition = directive.editionLabel ? `, edition ${directive.editionLabel}` : ''
  const role =
    directive.verdict.verdict === 'applies'
      ? `applies to this project (${directive.verdict.authority} is competent for ${directive.verdict.territoryId}, from the project's details, not verified)`
      : "authority unknown for this project (its Land is not recorded), so do not apply it as settled"
  const result = `- ${name}: authority practice of ${of}, published by the platform${edition}; ${role}`
  return result.length > MAX_TURN_LINE_CHARS ? `${result.slice(0, MAX_TURN_LINE_CHARS - 1)}…` : result
}

export type DayBasis = 'reference_day' | 'no_reference_day' | 'no_project'

export interface TurnDay {
  day: string
  basis: DayBasis
}

export interface TurnEditions {
  day: TurnDay
  bindingOn: string
}

export const OTHER_EDITION_BINDING = 'OTHER EDITION BINDING'

export const BINDING_EDITION_RULE =
  `An entry marked ${OTHER_EDITION_BINDING} is the office's copy of another edition than the one binding on that day, which ` +
  "the line names with the instrument that makes it binding. You may answer from the office's copy, but say which edition " +
  "binds on that day and that the office's copy is another edition."

function dayLine({ day, basis }: TurnDay): string {
  if (basis === 'reference_day') {
    return `Editions are those in force on ${day}, the project's reference day (the day its application was filed); answer from the edition listed here and name it.`
  }
  const why = basis === 'no_project' ? 'this conversation belongs to no project' : 'the project records no reference day'
  return `Editions are those in force today, ${day}, because ${why}; when an answer rests on one, say that you took today's date and why.`
}

export function renderBaseKnowledgeBlock(
  entries: readonly BaseKnowledgeEntry[],
  project: ProjectTerritory,
  listed: readonly ListedEdition[] = [],
  directives: readonly PlatformDirective[] = [],
  editions: TurnEditions | null = null,
): string | null {
  const confirmed = entries.filter((entry) => entry.status === 'confirmed')
  const unread = ASK_FOR_LICENCE ? entries.filter((entry) => entry.status === 'proposed' && entry.values.licenceClass === 'licensed') : []
  if (confirmed.length === 0 && unread.length === 0 && listed.length === 0 && directives.length === 0) return null
  const on = editions?.bindingOn ?? 'today'
  const dated = editions && confirmed.length > 0 ? [dayLine(editions.day)] : []
  const rule = confirmed.some((entry) => entry.binding && !entry.binding.held) ? [BINDING_EDITION_RULE] : []
  const head = [ASK_FOR_LICENCE ? `${BASE_KNOWLEDGE_HEADER} ${UNATTESTED_RULE}` : BASE_KNOWLEDGE_HEADER, ...dated, ...rule]
  let room = MAX_TURN_BLOCK_CHARS - charsOf(head) - MORE_LINE_RESERVE
  const all = [...confirmed.map((entry) => line(entry, project, on)), ...unread.map(unreadLine)]
  const shown = within(all.slice(0, MAX_TURN_ENTRIES), room)
  room -= charsOf(shown)
  const rest = all.length - shown.length
  const more = rest > 0 ? [`- … and ${rest} more not listed here.`] : []
  const listedLines = within(listed.slice(0, Math.max(0, MAX_TURN_ENTRIES - shown.length)).map(listedLine), room)
  room -= charsOf(listedLines)
  const directiveLines = within(directives.slice(0, Math.max(0, MAX_TURN_ENTRIES - shown.length - listedLines.length)).map(directiveLine), room)
  return [...head, ...shown, ...more, ...listedLines, ...directiveLines].join('\n')
}

const charsOf = (lines: readonly string[]) => lines.reduce((sum, text) => sum + text.length + 1, 0)

function within(lines: readonly string[], room: number): string[] {
  const kept: string[] = []
  let used = 0
  for (const text of lines) {
    if (used + text.length + 1 > room) break
    kept.push(text)
    used += text.length + 1
  }
  return kept
}
