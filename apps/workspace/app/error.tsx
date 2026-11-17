'use client'

import { useEffect } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { StatusDrawing } from '@/components/brand/status-drawing'
import { StatusScreen } from '@/components/brand/status-screen'
import { useTranslations } from '@/i18n'
import { errorsCopy } from '@/i18n/namespaces/errors'
import { capturePosthogException } from '@/lib/analytics/posthog'
import { errorReportHref, useCurrentAddress } from './error-report'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations(errorsCopy)

  const isAccess = isAccessDenial(error)
  const address = useCurrentAddress()

  useEffect(() => {
    console.error('[route error]', error)
    if (isAccess || error.digest) return
    capturePosthogException(error, { source: 'route-error-boundary' })
  }, [error, isAccess])

  return (
    <StatusScreen
      art={<StatusDrawing kind={isAccess ? 'closed' : 'fault'} className="w-72 sm:w-96" />}
      code={isAccess ? t('access.code') : t('appError.code')}
      title={isAccess ? t('access.title') : t('appError.title')}
      description={isAccess ? t('access.description') : t('appError.description')}
      actions={
        <>
          {/* Always offered, even on the access screen: an unknown error must
              never be hidden behind a dead-end, and even a genuine access
              denial can be transient (a role grant that just landed, a stale
              cache). */}
          <Button variant="secondary" onClick={reset}>
            {t('appError.action')}
          </Button>
          {isAccess ? (
            <Button asChild>
              <Link href="/">{t('access.action')}</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/app/projects">{t('appError.backAction')}</Link>
              </Button>
              <Button variant="ghost" asChild>
                <a href={errorReportHref(t, address, error.digest)}>{t('appError.report')}</a>
              </Button>
            </>
          )}
        </>
      }
      detail={!isAccess && error.digest ? t('appError.reference', { reference: error.digest }) : undefined}
    />
  )
}

function isAccessDenial(error: Error): boolean {
  const message = error.message.toLowerCase()
  return (
    message === 'not found' ||
    message.startsWith('not found:') ||
    message.includes('unauthorized') ||
    message.includes('forbidden')
  )
}
