'use client'

import { notFound, useSearchParams } from 'next/navigation'

import { GlobalErrorScreen } from '@/app/global-error'
import { isLocale } from '@/i18n'

export default function GlobalErrorPreviewPage() {
  const params = useSearchParams()
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const lang = params.get('lang') ?? 'de'
  return (
    <div data-testid="global-error-preview">
      <GlobalErrorScreen locale={isLocale(lang) ? lang : 'de'} retry={() => {}} />
    </div>
  )
}
