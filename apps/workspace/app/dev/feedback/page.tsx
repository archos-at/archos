'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { useSearchParams } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { OrgHeader } from '@/components/shell/org-header'
import { FeedbackProvider, useOpenFeedback } from '@/features/product-feedback/components'
import { PRODUCT_FEEDBACK_KINDS, type ProductFeedbackKind } from '@/lib/product-feedback/types'
import { feedbackPreviewApi } from '../_fixtures/feedback-threads'

const MESSAGE =
  'Beim Hochladen eines 80-MB-Plans bleibt der Fortschritt bei 99 % stehen. Nach einem Neuladen ist die Datei nicht im Projekt.'

function Preview(): JSX.Element {
  const params = useSearchParams()
  const variant = params.get('variant')
  const kindParam = params.get('kind')
  const kind: ProductFeedbackKind = PRODUCT_FEEDBACK_KINDS.includes(kindParam as ProductFeedbackKind)
    ? (kindParam as ProductFeedbackKind)
    : 'bug'
  const threadsApi = React.useMemo(() => feedbackPreviewApi('thread', { failSubmit: variant === 'error' }), [variant])

  React.useEffect(() => {
    if (variant !== 'sent' && variant !== 'error') return
    const timer = window.setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="feedback-message"]')
      if (!textarea) return
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, MESSAGE)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-testid="feedback-send"]')?.click(), 50)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [variant])

  return (
    <FeedbackProvider userEmail="maria.huber@buero-nord.at" threadsApi={threadsApi}>
      <OpenOnMount kind={kind} />
      <OrgHeader
        user={{ name: 'Maria Huber', email: 'maria.huber@buero-nord.at' }}
        organizationName="Architekturbüro Nord"
        authRequired={false}
        canManageOrganization={false}
        canViewOrganization
        canManagePlatform={false}
        canAccessOfficeShelf
        canAccessInbox={false}
      />
      <main className="text-muted-foreground p-8 text-sm">Projekte …</main>
    </FeedbackProvider>
  )
}

function OpenOnMount({ kind }: { kind: ProductFeedbackKind }): null {
  const openFeedback = useOpenFeedback()
  React.useEffect(() => openFeedback(kind), [openFeedback, kind])
  return null
}

export default function FeedbackDevPage(): JSX.Element {
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
