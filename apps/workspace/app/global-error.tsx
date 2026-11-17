'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { StatusDrawing } from '@/components/brand/status-drawing'
import { StatusScreen } from '@/components/brand/status-screen'
import { Button } from '@/components/ui/button'
import { defaultLocale, getActiveLocale, translatorFor, type Locale } from '@/i18n'
import { errorsCopy } from '@/i18n/namespaces/errors'
import { capturePosthogException } from '@/lib/analytics/posthog'
import { STORAGE_RENAME_BOOT_SCRIPT } from './storage-rename-boot'
import { THEME_BOOT_SCRIPT } from './theme-boot'
import { errorReportHref, useCurrentAddress } from './error-report'
import './globals.css'

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const locale = useSyncExternalStore(
    () => () => {},
    getActiveLocale,
    () => defaultLocale,
  )
  useEffect(() => {
    console.error('[global error]', error)
    if (error.digest) return
    capturePosthogException(error, { source: 'global-error-boundary' })
  }, [error])

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STORAGE_RENAME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-surface-base text-foreground font-sans antialiased">
        <GlobalErrorScreen locale={locale} retry={retry} digest={error.digest} />
      </body>
    </html>
  )
}

export function GlobalErrorScreen({
  locale,
  retry,
  digest,
}: {
  locale: Locale
  retry: () => void
  digest?: string
}) {
  const t = translatorFor(errorsCopy, locale)
  const address = useCurrentAddress()
  return (
    <StatusScreen
      art={<StatusDrawing kind="fault" className="w-72 sm:w-96" />}
      code={t('appError.code')}
      title={t('appError.title')}
      description={t('appError.description')}
      actions={
        <>
          <Button variant="secondary" onClick={retry}>
            {t('appError.action')}
          </Button>
          <Button asChild>
            {/* A plain anchor on purpose: see the header. */}
            {/* oxlint-disable-next-line next/no-html-link-for-pages -- the root layout crashed, so a full document load is the recovery; client navigation would reuse the broken tree */}
            <a href="/app/projects">{t('appError.backAction')}</a>
          </Button>
          <Button variant="ghost" asChild>
            <a href={errorReportHref(t, address, digest)}>{t('appError.report')}</a>
          </Button>
        </>
      }
      detail={digest ? t('appError.reference', { reference: digest }) : undefined}
    />
  )
}
