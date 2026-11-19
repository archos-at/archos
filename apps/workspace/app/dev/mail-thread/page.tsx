'use client'

import type { JSX } from 'react'
import { use, useMemo, useState } from 'react'
import { I18nProvider } from '@/i18n'
import { MailOriginLine, MailProvenanceRow, MailThreadTab, ThreadRailViews, type RailView } from '@/features/documents/components/mail-thread'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'
import { DevVariantStrip, HiddenDevChrome } from '../inbound-mail/dev-chrome'
import {
  ENTRY_TEXTS,
  MAIL_THREAD_VARIANTS,
  PROJECT_ID,
  PROVENANCE_ORIGINS,
  THREAD_DOCUMENT_ID,
  THREAD_FOLDER_ID,
  VIEWER_ID,
  fixtureMailThreadClient,
  versions,
} from './fixtures'

type SearchParams = Record<string, string | string[] | undefined>

const PROVENANCE_VARIANTS = ['provenance', 'provenance-worst'] as const
const VARIANTS = [...Object.keys(MAIL_THREAD_VARIANTS), ...PROVENANCE_VARIANTS]

const stayHere = async (_origin: MailOriginView): Promise<void> => {}

export default function MailThreadDevPage({ searchParams }: { searchParams: Promise<SearchParams> }): JSX.Element {
  const params = use(searchParams)
  const requested = typeof params.variant === 'string' ? params.variant : ''
  const variant = VARIANTS.includes(requested) ? requested : 'three-messages'
  const locale = params.locale === 'en' ? 'en' : 'de'
  return (
    <I18nProvider initialLocale={locale} fixedLocale>
      <main className="bg-background min-h-dvh pb-16" data-testid="mail-thread-preview">
        {variant === 'provenance' || variant === 'provenance-worst' ? <Provenance worst={variant === 'provenance-worst'} /> : <Tab key={variant} variant={variant} />}
        {params.chrome !== '0' ? <DevVariantStrip base="/dev/mail-thread" variants={VARIANTS} current={variant} locale={locale} /> : <HiddenDevChrome />}
      </main>
    </I18nProvider>
  )
}

function Tab({ variant }: { variant: string }): JSX.Element {
  const fixture = MAIL_THREAD_VARIANTS[variant]
  const client = useMemo(() => fixtureMailThreadClient(fixture), [fixture])
  const [view, setView] = useState<RailView>('mail')
  const focus = useMemo(() => (fixture.focusEntryId ? { entryId: fixture.focusEntryId } : undefined), [fixture.focusEntryId])
  return (
    // As the preview draws a Verlauf: its document on the stage, the rail 280px beside it on the same desk; on a phone
    // the rail alone, as its details sheet. A 280px strip alone in a 1440px window read as the product's layout.
    <div className="bg-desk flex min-h-dvh w-full" data-testid="mail-thread-frame">
      <section aria-label={fixture.view.name} className="hidden min-w-0 flex-1 p-6 sm:block">
        <article className="bg-sheet rounded-surface mx-auto flex max-w-2xl flex-col gap-5 p-8 text-sm shadow-sm">
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold [overflow-wrap:anywhere]">{fixture.view.name}</h1>
            <p className="text-muted-foreground text-xs">E-Mail-Verlauf · {fixture.view.entries.length} E-Mails</p>
          </header>
          {fixture.view.entries.map((item) => (
            <section key={item.id} className="flex flex-col gap-1.5">
              <h2 className="font-medium [overflow-wrap:anywhere]">{item.heading}</h2>
              <p className="text-muted-foreground leading-relaxed">{ENTRY_TEXTS[item.id] ?? '…'}</p>
            </section>
          ))}
        </article>
      </section>
      <aside className="flex w-full flex-col p-4 sm:w-[280px] sm:shrink-0 sm:box-content sm:pl-0">
      <ThreadRailViews
        mail={
          <MailThreadTab
            projectId={PROJECT_ID}
            documentId={THREAD_DOCUMENT_ID}
            threadId={fixture.view.id}
            folderId={THREAD_FOLDER_ID}
            viewerUserId={VIEWER_ID}
            focus={focus}
            openDetachFor={fixture.detachEntryId}
            client={client}
          />
        }
        mailCount={fixture.view.entries.length}
        value={view}
        onValueChange={setView}
        detailsLabel="Details"
      >
        <p className="text-muted-foreground text-xs">Details</p>
      </ThreadRailViews>
      </aside>
    </div>
  )
}

function Provenance({ worst }: { worst: boolean }): JSX.Element {
  const keys = worst ? (['worst'] as const) : (['verified', 'unverified', 'archive', 'anonymous', 'several', 'forwarded'] as const)
  const rowClient = useMemo(() => {
    const fixture = MAIL_THREAD_VARIANTS['three-messages']
    const base = fixtureMailThreadClient(fixture)
    const documentVersions = versions(2).map((version, index) => (index === 1 ? { ...version, mailOrigins: PROVENANCE_ORIGINS[worst ? 'worst' : 'verified'] } : version))
    return { ...base, versions: async () => ({ documentId: 'doc', lifecycle: 'active' as const, publishedVersionId: documentVersions[1].id, versions: documentVersions }) }
  }, [worst])
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      {/* The preview header's row, as the pane draws it under the header. */}
      <section className="@container bg-card overflow-hidden rounded-lg border" aria-label="Header">
        <div className="flex items-center gap-2 border-b px-3.5 py-3.5 @md:px-5">
          <span className="min-w-0 truncate text-sm font-medium">{worst ? 'Einreichplan_Hofseite_Stellplätze_Variante_3_final_INDEX_C.pdf' : 'S-101_B.pdf'}</span>
        </div>
        <MailProvenanceRow projectId={PROJECT_ID} documentId="doc" client={rowClient} />
      </section>
      {/* A Fassung row of the timeline, 248px of rail content. */}
      <section className="bg-surface-sunken flex flex-col gap-4 rounded-lg border p-4 sm:max-w-[280px]" aria-label="Fassungen">
        {keys.map((key) => (
          <div key={key} className="bg-card flex flex-col gap-1 rounded-lg border p-3">
            <p className="text-[13px] font-medium">Fassung 2</p>
            <MailOriginLine origins={PROVENANCE_ORIGINS[key]} onOpen={stayHere} />
          </div>
        ))}
      </section>
    </div>
  )
}
