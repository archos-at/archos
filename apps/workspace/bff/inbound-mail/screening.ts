import 'server-only'
import { chatScreeningRules, findSpans, type ContentScreenKind } from '@/lib/upload-screening/content-screen'
import { screenUploadName } from '@/lib/upload-screening/name-screen'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { gatePolicy } from '@/lib/upload-screening/service'

export const MAX_NAME_STOP_TERMS = 20

export interface MailScreening {
  nameStops(name: string): string[]
  contentFindings(ownText: string): ContentScreenKind[]
}

export async function mailScreeningFor(organizationId: string, projectId: string): Promise<MailScreening> {
  return mailScreening(await gatePolicy(organizationId, projectId))
}

export function mailScreening(policy: UploadScreeningPolicy): MailScreening {
  const contentRules = chatScreeningRules(policy)
  return {
    nameStops(name) {
      if (!name.trim()) return []
      const terms = screenUploadName(policy, { filename: name }).matches.map((match) => match.term)
      return [...new Set(terms)].slice(0, MAX_NAME_STOP_TERMS)
    },
    contentFindings(ownText) {
      if (!contentRules || !ownText) return []
      return [...new Set(findSpans(ownText, contentRules).map((span) => span.kind))]
    },
  }
}
