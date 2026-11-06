/**
 * Platform → Agents. How platform staff connect their own assistant to the
 * operator console's MCP door (ADR-0126) and to the cluster's own MCP servers
 * behind the platform MCP gateway (ADR-0154).
 *
 * Owner gate, shell chrome and section nav live in the shared `layout.tsx`;
 * this page decides what may be shown, on the server, and renders it.
 */

import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { getTranslations } from '@/i18n/server'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformConnect } from '@/features/agent-connect/components'
import { PLATFORM_MCP_RUNBOOK_URL } from '@/features/agent-connect/lib/guide'
import { loadPlatformConnectState } from '@/features/agent-connect/lib/platform-connect-state'

export default async function PlatformAgentsPage(): Promise<JSX.Element> {
  const t = await getTranslations(platformCopy)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('sections.agents.title')} subtitle={t('sections.agents.subtitle')} />
      <PlatformConnect state={loadPlatformConnectState()} runbookHref={PLATFORM_MCP_RUNBOOK_URL} />
    </div>
  )
}
