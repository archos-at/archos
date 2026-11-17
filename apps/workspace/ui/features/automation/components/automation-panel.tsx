'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ListChecks, Sparkles } from 'lucide-react'

import { ProjectSectionTabs } from '@/components/shell/project-section-frame'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SkillsPanel } from '@/features/skills/components/skills-panel'
import { TasksPanel } from '@/features/tasks/components/tasks-panel'
import type { TasksView } from '@/features/tasks/lib/tasks-view'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { parseAutomationTab, tabForDeepLink, type AutomationTab } from '../lib/automation-tab'

interface AutomationPanelProps {
  projectId: string
  canManageOrgSkills: boolean
  canManageJobs: boolean
  canChatInProject?: boolean
  initialTab: AutomationTab
  initialView?: TasksView
}

function deepLinkTab(): AutomationTab | null {
  try {
    if (typeof window === 'undefined') return null
    return tabForDeepLink(new URL(window.location.href).searchParams)
  } catch {
    return null
  }
}

function tabHref(next: AutomationTab): string {
  const url = new URL(window.location.href)
  url.searchParams.set('tab', next)
  return `${url.pathname}${url.search}${url.hash}`
}

export function AutomationPanel({
  projectId,
  canManageOrgSkills,
  canManageJobs,
  canChatInProject = true,
  initialTab,
  initialView = 'list',
}: AutomationPanelProps): JSX.Element {
  const t = useTranslations(navCopy)
  const [tab, setTab] = useState<AutomationTab>(() => deepLinkTab() ?? initialTab)
  const correctedRef = useRef(false)

  useEffect(() => {
    if (correctedRef.current) return
    const forced = deepLinkTab()
    if (!forced || forced === initialTab) return
    correctedRef.current = true
    setTab(forced)
    try {
      window.history.replaceState(null, '', tabHref(forced))
    } catch {
      // History unavailable (embedded preview) — the tab still switches.
    }
  }, [initialTab])

  const selectTab = (value: string): void => {
    const next = parseAutomationTab(value)
    setTab(next)
    try {
      window.history.replaceState(null, '', tabHref(next))
    } catch {
      // History unavailable (embedded preview) — the tab still switches.
    }
  }

  return (
    <Tabs value={tab} onValueChange={selectTab} className="h-full min-h-0 gap-0">
      {/* The two places as tabs in the section's header, under its title, where Dateien's stand
          (`ProjectSectionTabs`): they were a bar of their own under the header, with a second rule. */}
      <ProjectSectionTabs>
        <TabsList className="mb-2 h-8 bg-desk p-0.5" /* the track of Dateien's places: 32px on the desk */>
          <TabsTrigger value="tasks">
            <ListChecks aria-hidden />
            {t('sections.tasks')}
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Sparkles aria-hidden />
            {t('sections.skills')}
          </TabsTrigger>
        </TabsList>
      </ProjectSectionTabs>
      <TabsContent value="tasks" className="min-h-0 overflow-hidden">
        <TasksPanel
          projectId={projectId}
          canManageJobs={canManageJobs}
          canChatInProject={canChatInProject}
          initialView={initialView}
        />
      </TabsContent>
      <TabsContent value="skills" className="min-h-0 overflow-y-auto">
        <SkillsPanel canManageOrgSkills={canManageOrgSkills} />
      </TabsContent>
    </Tabs>
  )
}
