'use client'

/**
 * Dev preview of the status screens and their drawings (`StatusDrawing`), with
 * the real boundaries where they can run outside a crash:
 *
 *   ?screen=not-found  the not-found page: a door onto a room never built
 *   ?screen=access     `error.tsx` on a denial: the door swings shut
 *   ?screen=error      `error.tsx` on a fault thrown on the server (with a
 *                      digest, so its reference line shows): the propped beam
 *   ?screen=global     `global-error.tsx`'s screen, the same drawing
 *   (none)             all three drawings side by side, small
 *
 * `&lang=en` for English (German by default). Reload to watch a drawing draw
 * itself again; with reduced motion it is still from the start. The `/dev`
 * layout 404s this outside development.
 */

import type { JSX } from 'react'
import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import RouteError from '@/app/error'
import { GlobalErrorScreen } from '@/app/global-error'
import { StatusDrawing } from '@/components/brand/status-drawing'
import { StatusScreen } from '@/components/brand/status-screen'
import { Button } from '@/components/ui/button'
import { I18nProvider, isLocale, useTranslations, type Locale } from '@/i18n'
import { errorsCopy } from '@/i18n/namespaces/errors'

/** A server-thrown error as the client boundary receives it: a redacted message and a digest. */
const SERVER_ERROR = Object.assign(new Error('An error occurred in the Server Components render.'), {
  digest: '3812047752',
})
const ACCESS_ERROR = new Error('Not found')

function NotFoundScreen(): JSX.Element {
  const t = useTranslations(errorsCopy)
  return (
    <StatusScreen
      art={<StatusDrawing kind="missing" className="w-72 sm:w-96" />}
      code={t('notFound.code')}
      title={t('notFound.title')}
      description={t('notFound.description')}
      actions={
        <Button asChild>
          <Link href="/app/projects">{t('notFound.action')}</Link>
        </Button>
      }
    />
  )
}

function Overview(): JSX.Element {
  return (
    <div className="grid min-h-dvh place-content-center gap-6 bg-background p-6 sm:grid-cols-3">
      {(['missing', 'closed', 'fault'] as const).map((kind) => (
        <figure key={kind} className="m-0 w-72" data-preview={kind}>
          <StatusDrawing kind={kind} />
          <figcaption className="mt-2 text-xs text-muted-foreground">{kind}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function Screen({ screen, locale }: { screen: string | null; locale: Locale }): JSX.Element {
  if (screen === 'not-found') return <NotFoundScreen />
  if (screen === 'access') return <RouteError error={ACCESS_ERROR} reset={() => {}} />
  if (screen === 'error') return <RouteError error={SERVER_ERROR} reset={() => {}} />
  if (screen === 'global') return <GlobalErrorScreen locale={locale} retry={() => {}} digest={SERVER_ERROR.digest} />
  return <Overview />
}

function Preview(): JSX.Element {
  const params = useSearchParams()
  const lang = params?.get('lang') ?? 'de'
  const locale: Locale = isLocale(lang) ? lang : 'de'
  return (
    <I18nProvider initialLocale={locale} fixedLocale>
      <div data-testid="status-screens-preview">
        <Screen screen={params?.get('screen') ?? null} locale={locale} />
      </div>
    </I18nProvider>
  )
}

export default function StatusScreensPreviewPage(): JSX.Element {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
