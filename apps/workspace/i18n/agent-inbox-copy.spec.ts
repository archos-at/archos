/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { WAKE_END_REASON_KINDS } from '@/lib/annotations/wake-end-reason'
import { PROPOSAL_NOTICE_VARIANTS } from '@/lib/proposals/types'
import { de, en } from './dictionaries'
import { getByPath } from './translate'

const TYPES = 'collaboration.inbox.types'
const AGENT_TYPES = ['agentWorkDone', 'agentWorkFailed', 'agentAsksYou', 'agentProposalWaiting'] as const
const MARK_TYPES = ['agentWorkDone', 'agentWorkFailed', 'agentAsksYou'] as const

const JARGON: Record<'de' | 'en', RegExp> = {
  de: /\b(Wake|geweckt|Turn|Proposal|Delegation|Plan|Pläne)\b/iu,
  en: /\b(wake|woken|turn|delegation|plans?)\b/i,
}

function leaves(node: unknown, path: string, found: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === 'string') found.push([path, node])
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) leaves(value, `${path}.${key}`, found)
  }
  return found
}

const LOCALES = [
  ['de', de],
  ['en', en],
] as const

describe('Piloti’s inbox notices', () => {
  for (const [locale, dictionary] of LOCALES) {
    it(`${locale}: every failure class says why, in words of its own`, () => {
      const missing = WAKE_END_REASON_KINDS.filter(
        (kind) => typeof getByPath(dictionary, `${TYPES}.agentWorkFailed.variants.${kind}.body`) !== 'string',
      )
      expect(missing).toEqual([])
    })

    it(`${locale}: every kind of proposal says what it changes`, () => {
      const missing = PROPOSAL_NOTICE_VARIANTS.filter(
        (variant) => typeof getByPath(dictionary, `${TYPES}.agentProposalWaiting.variants.${variant}.title`) !== 'string',
      )
      expect(missing).toEqual([])
    })

    it(`${locale}: a notice about a mark names the mark and the document`, () => {
      for (const type of MARK_TYPES) {
        expect(getByPath(dictionary, `${TYPES}.${type}.titleRelated`)).toMatch(/\{related\}.*\{subject\}/)
        expect(getByPath(dictionary, `${TYPES}.${type}.titleRelatedNoSubject`)).toMatch(/\{related\}/)
      }
    })

    it(`${locale}: no system words`, () => {
      const offenders = AGENT_TYPES.flatMap((type) =>
        leaves(getByPath(dictionary, `${TYPES}.${type}`), `${TYPES}.${type}`),
      )
        .filter(([, text]) => JARGON[locale].test(text))
        .map(([path, text]) => `${path}: ${text}`)
      expect(offenders).toEqual([])
    })
  }
})
