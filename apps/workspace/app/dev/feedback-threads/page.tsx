'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { useSearchParams } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { FeedbackThreadsDialog } from '@/features/product-feedback/components'
import { feedbackPreviewApi, feedbackPreviewStart, parseFeedbackPreviewView } from '../_fixtures/feedback-threads'

function Preview(): JSX.Element {
  const view = parseFeedbackPreviewView(useSearchParams().get('view'))
  const [open, setOpen] = React.useState(true)
  const api = React.useMemo(() => feedbackPreviewApi(view), [view])
  return (
    <>
      <main className="text-muted-foreground p-8 text-sm">Projekte …</main>
      <FeedbackThreadsDialog
        open={open}
        onOpenChange={setOpen}
        initialReportId={feedbackPreviewStart(view)}
        initialCompose={view === 'compose' ? 'bug' : null}
        initialScope={view === 'office' ? 'office' : 'mine'}
        userEmail="maria.huber@buero-nord.at"
        api={api}
      />
    </>
  )
}

export default function FeedbackThreadsDevPage(): JSX.Element {
  return (
    <React.Suspense>
      <LocalePinned />
    </React.Suspense>
  )
}

function LocalePinned(): JSX.Element {
  const lang = useSearchParams().get('lang') === 'en' ? 'en' : 'de'
  return (
    <I18nProvider initialLocale={lang} fixedLocale>
      <div className="bg-background min-h-dvh">
        <Preview />
      </div>
    </I18nProvider>
  )
}
