'use client'

import type { JSX } from 'react'
import { use, useMemo } from 'react'
import { I18nProvider } from '@/i18n'
import { cn } from '@/lib/utils'
import { DevRailShell } from '../_fixtures/rail-shell'
import { InboundMailWorkspace } from '@/features/inbound-mail/components/inbound-mail-workspace'
import { ProjectSectionFrame } from '@/components/shell/project-section-frame'
import type { InboundMailPaths } from '@/lib/inbound-mail/paths'
import { ADDRESS_VARIANTS, DETAIL_BY_ID, FIXTURE_NOW, FOLDERS, LIST_VARIANTS, PROJECT_ID, PROJECT_NAME, fixtureAddressClient, fixtureClient, listPage } from './fixtures'
import { useSampleAttachmentUrls } from '../_fixtures/plan-sheet-pdf'
import { DevVariantStrip, HiddenDevChrome } from './dev-chrome'

type SearchParams = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined)

export default function InboundMailDevPage({ searchParams }: { searchParams: Promise<SearchParams> }): JSX.Element {
  const params = use(searchParams)
  const variant = one(params.variant) && LIST_VARIANTS[one(params.variant) as string] ? (one(params.variant) as string) : 'many'
  const locale = one(params.locale) === 'en' ? 'en' : 'de'
  const fixture = LIST_VARIANTS[variant]
  const status = one(params.status) === 'handled' ? 'handled' : (fixture.status ?? 'waiting')
  const outcomeParam = one(params.outcome)
  const outcome = outcomeParam === 'filed' || outcomeParam === 'dismissed' || outcomeParam === 'expired' ? outcomeParam : (fixture.outcome ?? null)
  const ownStatus = status === (fixture.status ?? 'waiting')
  const mailId = one(params.mail) ?? (ownStatus ? fixture.open : undefined) ?? null
  const pdfNames = useMemo(
    () => [...DETAIL_BY_ID.values()].flatMap((detail) => detail.view.parts.filter((part) => part.contentType === 'application/pdf' && part.filename).map((part) => part.filename as string)),
    []
  )
  const sheets = useSampleAttachmentUrls(pdfNames)
  const client = useMemo(() => {
    const base = fixtureClient({ list: fixture })
    const sheetOf = (mailId: string, partId: string): string =>
      sheets.get(DETAIL_BY_ID.get(mailId)?.view.parts.find((part) => part.id === partId)?.filename ?? '') ?? ''
    return { ...base, partContentUrl: (_project: string, mailId: string, partId: string) => sheetOf(mailId, partId) }
  }, [fixture, sheets])
  const addressClient = useMemo(
    () =>
      fixtureAddressClient(
        fixture.everReceived === false
          ? { ...(ADDRESS_VARIANTS.manager as Exclude<(typeof ADDRESS_VARIANTS)['manager'], string>), lastReceivedAt: null, receivedCount: 0 }
          : fixture.received !== undefined
            ? { ...(ADDRESS_VARIANTS.manager as Exclude<(typeof ADDRESS_VARIANTS)['manager'], string>), receivedCount: fixture.received }
            : ADDRESS_VARIANTS.manager
      ),
    [fixture]
  )
  const paths = useMemo<InboundMailPaths>(() => {
    const base = `/dev/inbound-mail?variant=${variant}${locale === 'en' ? '&locale=en' : ''}${one(params.chrome) === '0' ? '&chrome=0' : ''}`
    const filter = (f: { status: string; outcome: string | null }) => `${f.status !== 'waiting' ? `&status=${f.status}` : ''}${f.outcome ? `&outcome=${f.outcome}` : ''}`
    return {
      list: (f) => `${base}${filter(f)}`,
      mail: (id, f) => `${base}${filter(f)}&mail=${id}`,
      files: '/dev/files-header',
    }
  }, [variant, locale, params.chrome])
  const initial = mailId && ownStatus ? (DETAIL_BY_ID.get(mailId) ?? null) : null
  const initialList = useMemo(
    () => (fixture.load || !ownStatus ? null : listPage(fixture.items.filter((item) => item.status === status), fixture.nextCursor ?? null)),
    [fixture, status, ownStatus]
  )

  const inShell = one(params.rail) === '1'
  const filesPath = `/app/projects/${PROJECT_ID}/files/mail${mailId ? `/${mailId}` : ''}`
  const page = (
      <main className={cn('bg-background flex min-h-0 flex-col', inShell ? 'h-full' : 'h-dvh')} data-testid="inbound-mail-preview">
        {/* The real section frame, as the project's Dateien › E-Mail-Eingang heads it. */}
        <ProjectSectionFrame projectId={PROJECT_ID} projectName={PROJECT_NAME} pathname={filesPath} inboundMail>
        <InboundMailWorkspace
          key={`${variant}:${status}:${outcome ?? ''}`}
          projectId={PROJECT_ID}
          projectName={PROJECT_NAME}
          projectClosed={fixture.closed ?? false}
          folders={FOLDERS}
          status={status}
          outcome={outcome}
          initialList={initialList}
          initialListFailed={fixture.load === 'error'}
          listLoading={fixture.load === 'loading'}
          mailId={mailId}
          initialMail={initial?.view ?? null}
          initialText={initial?.text ?? null}
          client={client}
          addressClient={addressClient}
          paths={paths}
          now={FIXTURE_NOW}
          initialChecked={fixture.checked}
        />
        </ProjectSectionFrame>
        {one(params.chrome) === '0' ? <HiddenDevChrome /> : !inShell && <DevVariantStrip base="/dev/inbound-mail" variants={Object.keys(LIST_VARIANTS)} current={variant} locale={locale} />}
      </main>
  )

  return (
    <I18nProvider initialLocale={locale} fixedLocale>
      {inShell ? (
        <DevRailShell projectId={PROJECT_ID} projectName={PROJECT_NAME} pathname={filesPath}>
          {page}
        </DevRailShell>
      ) : (
        page
      )}
    </I18nProvider>
  )
}
