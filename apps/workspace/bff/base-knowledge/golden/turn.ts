/**
 * What a golden turn reads in place of a project (ADR-0165 amendment): the
 * knowledge context of the site its case states, and the case's facts where a
 * project's profile would stand. Everything else of the turn is the ordinary
 * one's.
 *
 * Only a conversation a golden run asked in has a case, and a run asks in the
 * platform organization, so every other organization's turn returns before any
 * read: an office's turn pays nothing for this.
 */

import 'server-only'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { knowledgeContextForStatedSite } from '../context/service'
import type { KnowledgeContext } from '../context/wire'
import type { GoldenCase } from '../wire/golden-case'
import { goldenCaseOfConversation } from './repository'

export interface GoldenTurn {
  knowledgeContext: KnowledgeContext
  /** The case's stated facts, as the turn's project context; null when it states none. */
  projectContext: string | null
}

/** The stated facts as the lines a turn reads: `key=value`, sorted, under one line saying whose they are. Pure. */
export function statedFactsBlock(golden: Pick<GoldenCase, 'context'>): string | null {
  const facts = Object.entries(golden.context.facts).sort(([a], [b]) => a.localeCompare(b))
  const lines = [
    ...(golden.context.territoryId ? [`site_territory=${golden.context.territoryId}`] : []),
    ...(golden.context.referenceDate ? [`filed_on=${golden.context.referenceDate}`] : []),
    ...facts.map(([key, value]) => `${key}=${String(value)}`),
  ]
  return lines.length === 0 ? null : ['Stated facts of the building in question (no project is open):', ...lines].join('\n')
}

/**
 * The golden turn of a conversation, or null for every conversation that is not a golden run's. Never throws:
 * a read that fails is logged and the turn is the ordinary one, which a golden run then scores as it finds it.
 */
export async function goldenTurnFor(organizationId: string, conversationId: string | null | undefined): Promise<GoldenTurn | null> {
  if (!conversationId) return null
  try {
    if (organizationId !== (await getPlatformOrganizationId())) return null
    const found = await goldenCaseOfConversation(conversationId)
    if (!found || found.askedIn !== organizationId) return null
    const { territoryId, referenceDate } = found.golden.context
    return {
      knowledgeContext: await knowledgeContextForStatedSite(organizationId, { territoryId, filedOn: referenceDate }),
      projectContext: statedFactsBlock(found.golden),
    }
  } catch (error) {
    console.error('[golden-run] the golden turn of a conversation could not be read', { organizationId, conversationId, error })
    return null
  }
}
