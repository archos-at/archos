'use client'

import type { JSX } from 'react'
import { use, useEffect, useMemo, useState } from 'react'
import { I18nProvider } from '@/i18n'
import { InboundMailDetail } from '@/features/inbound-mail/components/inbound-mail-detail'
import { DETAIL_VARIANTS, FIXTURE_NOW, FOLDERS, PROJECT_ID, fixtureClient } from '../inbound-mail/fixtures'
import { DevVariantStrip } from '../inbound-mail/dev-chrome'

type SearchParams = Record<string, string | string[] | undefined>

/** A plan set's stand-in: a few A3 pages with a title each, so the thumbnail and the viewer's page steps have pages. */
function samplePdf(pages: number): string {
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '']
  const kids: string[] = []
  for (let page = 0; page < pages; page += 1) {
    const pageObject = 4 + page * 2
    kids.push(`${pageObject} 0 R`)
    const stream = `BT /F1 36 Tf 60 760 Td (Blatt ${page + 1} von ${pages}) Tj ET 40 40 1110 802 re S 60 700 m 1130 700 l S`
    objects[pageObject - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`
    objects[pageObject] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return URL.createObjectURL(new Blob([body], { type: 'application/pdf' }))
}

export default function InboundMailDetailDevPage({ searchParams }: { searchParams: Promise<SearchParams> }): JSX.Element {
  const params = use(searchParams)
  const requested = typeof params.variant === 'string' ? params.variant : ''
  const variant = DETAIL_VARIANTS[requested] ? requested : 'mixed-attachments'
  const locale = params.locale === 'en' ? 'en' : 'de'
  const fixture = DETAIL_VARIANTS[variant]
  const [pdf, setPdf] = useState<string | null>(null)
  useEffect(() => {
    const url = samplePdf(3)
    setPdf(url)
    return () => URL.revokeObjectURL(url)
  }, [])
  const client = useMemo(() => {
    const base = fixtureClient({ detail: fixture })
    // The held bytes of a clean PDF are the sample's here, so „Vorschau“ and its viewer show something to read.
    const isPdf = (partId: string): boolean => fixture.view.parts.some((part) => part.id === partId && part.contentType === 'application/pdf')
    return { ...base, partContentUrl: (_project: string, _mail: string, partId: string) => (pdf && isPdf(partId) ? pdf : '') }
  }, [fixture, pdf])
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
        {params.chrome !== '0' && <DevVariantStrip base="/dev/inbound-mail-detail" variants={Object.keys(DETAIL_VARIANTS)} current={variant} locale={locale} />}
      </main>
    </I18nProvider>
  )
}
