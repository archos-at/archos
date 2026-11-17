import 'server-only'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { knowledgeContextForStatedSite } from '../context/service'
import type { KnowledgeContext } from '../context/wire'
import type { GoldenCase } from '../wire/golden-case'
import { goldenCaseOfConversation } from './repository'

export interface GoldenTurn {
  knowledgeContext: KnowledgeContext
  projectContext: string | null
}

export function statedFactsBlock(golden: Pick<GoldenCase, 'context'>): string | null {
  const facts = Object.entries(golden.context.facts).sort(([a], [b]) => a.localeCompare(b))
  const lines = [
    ...(golden.context.territoryId ? [`site_territory=${golden.context.territoryId}`] : []),
    ...(golden.context.referenceDate ? [`filed_on=${golden.context.referenceDate}`] : []),
    ...facts.map(([key, value]) => `${key}=${String(value)}`),
  ]
  return lines.length === 0 ? null : ['Stated facts of the building in question (no project is open):', ...lines].join('\n')
}

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
