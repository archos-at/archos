import type { McpServer } from '@modelcontextprotocol/server'
import { RESOURCE_ICONS } from '../icons'
import { doorOfPrincipal, findVisibleOperation } from '../policy'
import type { McpCallContext } from '../telemetry'
import { DOOR_DOCS } from './docs.generated'
import { GUIDE_URI } from './index'

export const ONBOARDING_GUIDE_URI = GUIDE_URI.replace(/guide$/, 'platform/onboarding-guide')

export function offersOnboardingGuide(ctx: McpCallContext): boolean {
  return (
    doorOfPrincipal(ctx.principal) === 'platform' &&
    findVisibleOperation(ctx.principal, 'platform-knowledge-records-propose') !== undefined
  )
}

export function registerOnboardingGuide(server: McpServer, ctx: McpCallContext): void {
  if (!offersOnboardingGuide(ctx)) return
  server.registerResource(
    'onboarding-guide',
    ONBOARDING_GUIDE_URI,
    {
      title: 'Onboarding a country',
      description: 'How to bring a country’s knowledge in through this door: captures, dry runs, validation, review, and what the person decides.',
      mimeType: 'text/markdown',
      icons: RESOURCE_ICONS.guide,
    },
    async () => ({ contents: [{ uri: ONBOARDING_GUIDE_URI, mimeType: 'text/markdown', text: DOOR_DOCS['platform/onboarding-guide.md'] }] }),
  )
}
