/**
 * The office's base knowledge as the agent reads it in a turn (ADR-0158): one
 * bounded line per confirmed entry, under a header that says how far each kind
 * binds. English, because the agent reads it; titles, designations, editions
 * and authority names are the office's own domain data. Pure.
 *
 * What the lines make true in an answer:
 * - an office copy of a norm the platform only lists is found by its file name
 *   and cited with its edition, for this office only (nobody else's turn has it);
 * - a commentary is interpretation, never the source of a requirement;
 * - a directive applies only when its authority decides for the project's
 *   territory, and an unknown authority is said, not guessed;
 * - every line carries its last check, and an overdue one says so;
 * - a licensed copy the office has not confirmed for AI processing is named as
 *   held, and its text is not used (design §4.7).
 */

import type { BaseKnowledgeEntry } from '../wire'
import { directiveApplicability, type ProjectTerritory } from './authority'

/** Most entries the block carries; the rest are named by count. */
export const MAX_TURN_ENTRIES = 40

/** Longest line. */
export const MAX_TURN_LINE_CHARS = 400

export const BASE_KNOWLEDGE_HEADER =
  "The office's own base knowledge: copies it holds in its Archiv (the Büroablage), for this office only; find a passage " +
  'by searching the Archiv for the file. When an answer rests on one, name its designation or title, its edition and when it was last ' +
  'checked; when the check is overdue, say so in the answer. The role decides what a passage can carry: ' +
  '"requirement source" may ground a requirement; "interpretation only" may explain a provision but never be cited ' +
  'as the source of a requirement; "authority practice" counts only where it says it applies, and when the authority ' +
  'is unknown, say that you could not tell whether the directive applies. An entry marked TEXT NOT USED has no ' +
  'passages to find: say the office holds that edition, and answer the rest from other sources.'

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

function line(entry: BaseKnowledgeEntry, project: ProjectTerritory): string {
  const { values } = entry
  const name = values.designation ? `${values.designation} „${values.title}“` : `„${values.title}“`
  const parts = [
    `${name}: ${KIND_WORDS[values.kind]}, edition ${values.editionLabel}`,
    `role: ${role(entry, project)}`,
    entry.textUse === 'metadata_only'
      ? 'TEXT NOT USED: the office holds this edition, but its licence is not confirmed for AI processing; say so, and do not quote or paraphrase it'
      : `file „${entry.fileName}“`,
    entry.textUse === 'used' && values.licenceClass === 'licensed' ? 'licensed copy' : null,
    checkWords(entry),
  ].filter(Boolean)
  const text = `- ${parts.join('; ')}`
  return text.length > MAX_TURN_LINE_CHARS ? `${text.slice(0, MAX_TURN_LINE_CHARS - 1)}…` : text
}

/** The block, or null when the office holds no confirmed entry. */
export function renderBaseKnowledgeBlock(entries: readonly BaseKnowledgeEntry[], project: ProjectTerritory): string | null {
  const confirmed = entries.filter((entry) => entry.status === 'confirmed')
  if (confirmed.length === 0) return null
  const shown = confirmed.slice(0, MAX_TURN_ENTRIES).map((entry) => line(entry, project))
  const rest = confirmed.length - shown.length
  const more = rest > 0 ? [`- … and ${rest} more not listed here.`] : []
  return [BASE_KNOWLEDGE_HEADER, ...shown, ...more].join('\n')
}
