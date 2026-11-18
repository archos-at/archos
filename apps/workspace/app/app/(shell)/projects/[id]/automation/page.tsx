import type { JSX } from 'react'
import { type Metadata } from 'next'
import { notFound } from 'next/navigation'
import { withPageSession } from '@/lib/auth/require-auth'
import { requireProjectAccess } from '@/lib/authz/projects'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { canManageSkills } from '@/lib/authz/organizations'
import { isSkillsEnabled } from '@/lib/authz/feature-flags'
import { findProjectInOrg } from '@/lib/projects/repository'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'
import { AutomationPanel } from '@/features/automation/components/automation-panel'
import { parseAutomationTab } from '@/features/automation/lib/automation-tab'
import { parseTasksView } from '@/features/tasks/lib/tasks-view'

interface AutomationPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; view?: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('sections.automation') }
}

export default async function AutomationPage({
  params,
  searchParams,
}: AutomationPageProps): Promise<JSX.Element> {
  return withPageSession(async (session) => {
    if (!isSkillsEnabled(session)) {
      notFound()
    }
    const { id } = await params
    const { tab, view } = await searchParams
    await requireProjectAccess(session, id, 'project:view')

    const project = await findProjectInOrg(id, session.organizationId)
    if (!project) {
      notFound()
    }

    let canManageJobs = false
    try {
      await requireProjectAccess(session, id, 'project:skills:manage')
      canManageJobs = true
    } catch {
      // Read-only.
    }

    let canChatInProject = false
    try {
      await requireProjectAccess(session, id, CHAT_PERMISSIONS)
      canChatInProject = true
    } catch {
      // Read-only chat.
    }

    const initialView = tab === 'schedule' && !view ? 'timetable' : parseTasksView(view)
    return (
      <AutomationPanel
        projectId={id}
        canManageOrgSkills={canManageSkills(session)}
        canManageJobs={canManageJobs}
        canChatInProject={canChatInProject}
        initialTab={parseAutomationTab(tab)}
        initialView={initialView}
      />
    )
  })
}
