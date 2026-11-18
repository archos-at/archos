'use client'

import { Suspense, type JSX } from 'react'
import { useSearchParams } from 'next/navigation'

import { I18nProvider, type Locale } from '@/i18n'
import { UsageAnalyticsSettings } from '@/app/app/(shell)/profile/usage-analytics-settings'

export default function UsageAnalyticsPreviewPage(): JSX.Element {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}

function Preview(): JSX.Element {
  const lang = useSearchParams().get('lang')
  const locale: Locale = lang === 'en' ? 'en' : 'de'

  return (
    <I18nProvider initialLocale={locale} fixedLocale>
      <main className="min-h-dvh bg-background px-4 py-10" data-testid="usage-analytics-preview">
        <h1 className="mx-auto mb-6 max-w-2xl font-mono text-xs text-muted-foreground">
          /dev/usage-analytics — Nutzungsanalyse ({locale})
        </h1>
        <div className="mx-auto max-w-2xl">
          <UsageAnalyticsSettings available />
        </div>
      </main>
    </I18nProvider>
  )
}
