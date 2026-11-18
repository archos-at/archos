'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { ProjectSectionFrame } from '@/components/shell/project-section-frame'
import { AutomationPanel } from '@/features/automation/components/automation-panel'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __automationShim?: boolean }
  if (!w.__automationShim) {
    w.__automationShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === '/api/skills') return Response.json({ skills: [] })
      if (url.includes('/runs')) return Response.json({ runs: [], nextCursor: null })
      if (url.includes('/tasks') && !url.includes('/run')) {
        return Response.json({ tasks: [], nextCursor: null })
      }
      return real(input, init)
    }
  }
}

export default function AutomationDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="automation-preview"
        className="bg-background text-foreground flex h-dvh flex-col"
      >
        {/* Inside the real section frame: the panel's tabs stand in its header (`ProjectSectionTabs`). */}
        <ProjectSectionFrame projectId="p1" projectName="Holzbau Wien" pathname="/app/projects/p1/automation">
          <AutomationPanel projectId="p1" canManageOrgSkills canManageJobs initialTab="tasks" />
        </ProjectSectionFrame>
      </main>
    </I18nProvider>
  )
}
