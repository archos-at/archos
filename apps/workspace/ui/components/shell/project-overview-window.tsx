'use client'

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import { ProjectOverview } from '@/components/projects/project-overview'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PageSheetClose } from '@/components/ui/page-sheet'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { projectsCopy } from '@/i18n/namespaces/projects'
import type { OverviewProject } from '@/lib/projects/overview-project'
import { OVERVIEW_PARAM } from './landing'
import { openProjectOverview, useProjectOverview } from './project-overview-entry'

export interface ProjectOverviewWindowProps {
  projects: OverviewProject[]
  viewerActivity: Record<string, string>
  /** What scrolls under the projects („Kürzlich gelöscht“), handed in by the layout. */
  after?: ReactNode
}

export function ProjectOverviewWindow({ projects, viewerActivity, after }: ProjectOverviewWindowProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const tCommon = useTranslations(commonCopy)
  const pathname = usePathname()
  const open = useProjectOverview((state) => state.open)
  const create = useProjectOverview((state) => state.create)
  const summon = useProjectOverview((state) => state.summon)
  const setOpen = useProjectOverview((state) => state.setOpen)

  const shownOn = useRef(pathname)
  useEffect(() => {
    if (shownOn.current === pathname) return
    shownOn.current = pathname
    setOpen(false)
  }, [pathname, setOpen])

  const asked = useSearchParams()?.get(OVERVIEW_PARAM) ?? null
  const answered = useRef(false)
  useEffect(() => {
    if (!asked) return
    const url = new URL(window.location.href)
    url.searchParams.delete(OVERVIEW_PARAM)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    if (answered.current) return
    answered.current = true
    openProjectOverview({ create: asked === 'new', summon: 'keyboard' })
  }, [asked])

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    const target = useProjectOverview.getState().returnFocus
    if (target?.isConnected) target.focus({ preventScroll: true })
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        instant={summon === 'keyboard'}
        showCloseButton={false}
        onCloseAutoFocus={handleCloseAutoFocus}
        data-testid="project-overview-window"
        className="bg-background flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px] md:max-h-[min(84dvh,calc(100dvh-2rem))]"
      >
        <DialogTitle className="sr-only">{t('portfolio.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('portfolio.title')}</DialogDescription>
        <ProjectOverview
          projects={projects}
          viewerActivity={viewerActivity}
          autoOpenCreate={create}
          closeAction={<PageSheetClose label={tCommon('actions.close')} />}
          after={after}
        />
      </DialogContent>
    </Dialog>
  )
}
