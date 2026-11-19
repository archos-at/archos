'use client'

import type { JSX } from 'react'
import { use, useMemo } from 'react'
import { I18nProvider } from '@/i18n'
import { InboundMailDetail } from '@/features/inbound-mail/components/inbound-mail-detail'
import { DETAIL_VARIANTS, FIXTURE_NOW, FOLDERS, PROJECT_ID, fixtureClient } from '../inbound-mail/fixtures'
import { useSampleAttachmentUrls } from '../_fixtures/plan-sheet-pdf'
import { DevVariantStrip, HiddenDevChrome } from '../inbound-mail/dev-chrome'

type SearchParams = Record<string, string | string[] | undefined>

export default function InboundMailDetailDevPage({ searchParams }: { searchParams: Promise<SearchParams> }): JSX.Element {
  const params = use(searchParams)
  const requested = typeof params.variant === 'string' ? params.variant : ''
  const variant = DETAIL_VARIANTS[requested] ? requested : 'mixed-attachments'
  const locale = params.locale === 'en' ? 'en' : 'de'
  const fixture = DETAIL_VARIANTS[variant]
  const pdfNames = useMemo(
    () => fixture.view.parts.filter((part) => part.contentType === 'application/pdf' && part.filename).map((part) => part.filename as string),
    [fixture]
  )
  const sheets = useSampleAttachmentUrls(pdfNames)
  const client = useMemo(() => {
    const base = fixtureClient({ detail: fixture })
    // The held bytes of a clean PDF are a plan sheet titled with its name, so its thumbnail, „Vorschau“ and the viewer show a drawing.
    const sheetOf = (partId: string): string => sheets.get(fixture.view.parts.find((part) => part.id === partId)?.filename ?? '') ?? ''
    return { ...base, partContentUrl: (_project: string, _mail: string, partId: string) => sheetOf(partId) }
  }, [fixture, sheets])
  return (
    <I18nProvider initialLocale={locale} fixedLocale>
      <main className="bg-background min-h-dvh" data-testid="inbound-mail-detail-preview">
        {/* The page scrolls, as `<main>` does in the app, so the decision bar sticks to the viewport and a full-page capture holds the whole mail. */}
        <div className="@container bg-background mx-auto flex min-h-dvh w-full max-w-4xl flex-col border-x">
          <InboundMailDetail
            key={variant}
            projectId={PROJECT_ID}
            mailId={fixture.view.id}
            initial={fixture.load ? null : fixture.view}
            initialText={fixture.load ? null : fixture.text}
            folders={FOLDERS}
            client={client}
            onChanged={() => {}}
            now={FIXTURE_NOW}
            decidedByOther={fixture.decidedByOther}
            pollMs={600}
          />
        </div>
        {params.chrome !== '0' ? <DevVariantStrip base="/dev/inbound-mail-detail" variants={Object.keys(DETAIL_VARIANTS)} current={variant} locale={locale} /> : <HiddenDevChrome />}
      </main>
    </I18nProvider>
  )
}
