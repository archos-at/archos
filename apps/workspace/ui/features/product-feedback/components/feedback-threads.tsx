'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { MessagesSquare, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useFitToVisualViewport } from '@/hooks/use-visual-viewport'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import type { ProductFeedbackKind } from '@/lib/product-feedback/types'
import { cn } from '@/lib/utils'
import { FeedbackForm } from './feedback-form'
import { CaseList } from './feedback-threads/case-list'
import { PaneHeader } from './feedback-threads/pane-header'
import { ThreadView } from './feedback-threads/thread-view'
import { LIVE_API, type FeedbackScope, type FeedbackThreadsApi } from '../lib/feedback-threads-api'

export { THREAD_POLL_MS } from './feedback-threads/thread-view'
export type { FeedbackScope, FeedbackThreadsApi } from '../lib/feedback-threads-api'

export interface FeedbackThreadsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialReportId?: string | null
  initialCompose?: ProductFeedbackKind | null
  initialScope?: FeedbackScope
  userEmail?: string | null
  onUpdatedCount?: (count: number) => void
  api?: FeedbackThreadsApi
}

type Pane =
  | { view: 'none' }
  | { view: 'thread'; reportId: string; justSent: boolean }
  | { view: 'compose'; kind: ProductFeedbackKind; draft: number }

let drafts = 0

function startPane(reportId: string | null, compose: ProductFeedbackKind | null): Pane {
  if (compose) return { view: 'compose', kind: compose, draft: ++drafts }
  if (reportId) return { view: 'thread', reportId, justSent: false }
  return { view: 'none' }
}

export function FeedbackThreadsDialog({
  open,
  onOpenChange,
  initialReportId = null,
  initialCompose = null,
  initialScope = 'mine',
  userEmail = null,
  onUpdatedCount,
  api = LIVE_API,
}: FeedbackThreadsDialogProps): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const tCommon = useTranslations(commonCopy)
  const [pane, setPane] = React.useState<Pane>(() => startPane(initialReportId, initialCompose))
  const [scope, setScope] = React.useState<FeedbackScope>(initialScope)
  const [listVersion, setListVersion] = React.useState(0)
  const [sending, setSending] = React.useState(false)
  const [canViewOffice, setCanViewOffice] = React.useState(false)
  const [panel, setPanel] = React.useState<HTMLDivElement | null>(null)
  const phone = useMediaQuery(PHONE_QUERY)
  useFitToVisualViewport(open && phone ? panel : null)

  React.useEffect(() => {
    if (!open) return
    setPane(startPane(initialReportId, initialCompose))
    setScope(initialScope)
  }, [open, initialReportId, initialCompose, initialScope])

  const compose = React.useCallback((): void => setPane({ view: 'compose', kind: 'bug', draft: ++drafts }), [])
  const back = React.useCallback((): void => setPane({ view: 'none' }), [])
  const select = React.useCallback(
    (reportId: string): void => setPane({ view: 'thread', reportId, justSent: false }),
    [],
  )
  const sent = (reportId: string): void => {
    setScope('mine')
    setListVersion((version) => version + 1)
    setPane({ view: 'thread', reportId, justSent: true })
  }

  const office = scope === 'office'
  const detailOpen = pane.view !== 'none'
  const selectedId = pane.view === 'thread' ? pane.reportId : null
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && sending) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        ref={setPanel}
        fullScreenOnMobile
        closeLabel={tCommon('actions.close')}
        className="flex h-[min(48rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 phone:pr-[env(safe-area-inset-right)] phone:pl-[env(safe-area-inset-left)] sm:max-w-xl md:max-w-5xl"
        data-testid="feedback-threads"
      >
        <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[24rem_minmax(0,1fr)]">
          <section
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col md:border-r', detailOpen && 'max-md:hidden')}
            data-testid="feedback-list-pane"
          >
            <PaneHeader
              heading={<DialogTitle className="text-base leading-tight">{office ? t('threads.officeTitle') : t('threads.title')}</DialogTitle>}
              description={
                <DialogDescription className="text-xs text-pretty">
                  {office ? t('threads.officeDescription') : t('threads.description')}
                </DialogDescription>
              }
              className="max-md:pr-14"
            >
              <div className="flex items-center gap-2">
                {canViewOffice && (
                  <Tabs value={scope} onValueChange={(next) => setScope(next as FeedbackScope)} className="min-w-0 flex-1">
                    <TabsList className="w-full" aria-label={t('threads.scopeLabel')}>
                      <TabsTrigger value="mine" data-testid="feedback-scope-mine">
                        {t('threads.scope.mine')}
                      </TabsTrigger>
                      <TabsTrigger value="office" data-testid="feedback-scope-office">
                        {t('threads.scope.office')}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={compose}
                  className={cn(!canViewOffice && 'flex-1')}
                  aria-current={pane.view === 'compose' || undefined}
                  data-testid="feedback-new"
                >
                  <Plus className="size-4" aria-hidden />
                  {t('threads.new')}
                </Button>
              </div>
            </PaneHeader>
            {open && (
              <CaseList
                key={`${scope}:${listVersion}`}
                scope={scope}
                api={api}
                selectedId={selectedId}
                onSelect={select}
                onNewFeedback={compose}
                onUpdatedCount={office ? undefined : onUpdatedCount}
                onCanViewOffice={setCanViewOffice}
              />
            )}
          </section>
          <section
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !detailOpen && 'max-md:hidden')}
            data-testid="feedback-detail-pane"
          >
            {pane.view === 'thread' && (
              <ThreadView
                key={pane.reportId}
                reportId={pane.reportId}
                justSent={pane.justSent}
                api={api}
                onBack={back}
                onNewFeedback={compose}
              />
            )}
            {pane.view === 'compose' && (
              <>
                <PaneHeader
                  onBack={back}
                  heading={<h2 className="text-base leading-tight font-medium">{t('threads.new')}</h2>}
                  description={<p className="text-muted-foreground text-xs text-pretty">{t('dialog.description')}</p>}
                />
                <FeedbackForm
                  key={pane.draft}
                  defaultKind={pane.kind}
                  userEmail={userEmail}
                  submit={api.submit}
                  onSent={sent}
                  onCancel={back}
                  onSendingChange={setSending}
                />
              </>
            )}
            {pane.view === 'none' && (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                  icon={MessagesSquare}
                  title={t('threads.pick.title')}
                  description={t('threads.pick.description')}
                  action={<Button onClick={compose}>{t('threads.new')}</Button>}
                />
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
