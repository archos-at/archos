'use client'

import type { JSX, MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ProjectOverview } from '@/components/projects/project-overview'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PageSheetClose } from '@/components/ui/page-sheet'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { projectsCopy } from '@/i18n/namespaces/projects'
import type { OverviewProject } from '@/lib/projects/overview-project'
import { PROJECT_OVERVIEW_PATH } from './landing'
import { useProjectOverview } from './project-overview-entry'

const STANDALONE_CLOSE_HREF = '/app'

export interface ProjectOverviewWindowProps {
  projects: OverviewProject[]
  viewerActivity: Record<string, string>
  /** What scrolls under the projects („Kürzlich gelöscht“), handed in by the layout. */
  after?: ReactNode
}

export function ProjectOverviewWindow({ projects, viewerActivity, after }: ProjectOverviewWindowProps): JSX.Element {
  const t = useTranslations(projectsCopy)
  const tCommon = useTranslations(commonCopy)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const asked = useProjectOverview((state) => state.open)
  const askedCreate = useProjectOverview((state) => state.create)
  const summon = useProjectOverview((state) => state.summon)
  const setAsked = useProjectOverview((state) => state.setOpen)
  const [leaving, setLeaving] = useState(false)

  const shownOn = useRef(pathname)
  useEffect(() => {
    if (shownOn.current === pathname) return
    shownOn.current = pathname
    setAsked(false)
    setLeaving(false)
  }, [pathname, setAsked])

  const onItsOwnPage = pathname === PROJECT_OVERVIEW_PATH
  const open = asked || (onItsOwnPage && !leaving)
  const create = asked ? askedCreate : searchParams?.get('new') === '1'

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return
      setAsked(false)
      if (!onItsOwnPage) return
      setLeaving(true)
      router.push(STANDALONE_CLOSE_HREF)
    },
    [onItsOwnPage, router, setAsked]
  )

  const closeOnLink = useCallback(
    (event: MouseEvent) => {
      const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      if (plain && (event.target as Element).closest('a[href]')) setAsked(false)
    },
    [setAsked]
  )

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    const target = useProjectOverview.getState().returnFocus
    const back = target?.isConnected ? target : document.getElementById('main-content')
    back?.focus({ preventScroll: true })
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        instant={!asked || summon === 'keyboard'}
        showCloseButton={false}
        onCloseAutoFocus={handleCloseAutoFocus}
        onClickCapture={closeOnLink}
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
