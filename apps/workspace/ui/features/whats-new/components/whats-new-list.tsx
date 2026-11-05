'use client'

/**
 * What's new: every change to the product, a page of weeks at a time, narrowed by product area
 * (ADR-0154). The organism of `/app/whats-new`.
 *
 * It renders what the server already chose: the page, the area and the reader's language
 * (`localizeReleaseNotes`). The filter and the pager are links, so a filtered page has an address
 * to share and the back button undoes a filter. Within a week the changes come in the order the
 * release notes keep (new, improved, then the small print); the fixes are folded, because a
 * returning member scans what they gained before what was repaired.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Chip, ChipCount } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { whatsNewCopy } from '@/i18n/namespaces/whats-new'
import type {
  LocalizedReleaseNote,
  LocalizedReleaseNoteList,
  LocalizedReleaseNoteWeek,
  ReleaseNoteArea,
  ReleaseNoteSection,
} from '@/lib/release-notes/release-notes-wire'
import { RELEASE_NOTE_SECTIONS } from '@/lib/release-notes/release-notes-wire'

/** The sections shown folded: ordinary fixes, read on demand. */
const FOLDED: ReadonlySet<ReleaseNoteSection> = new Set(['fixes'])

export interface WhatsNewListProps {
  list: LocalizedReleaseNoteList
  /** The page's own path; the filter and the pager add their query to it. */
  basePath?: string
}

/** The address of one page of the list. */
export function whatsNewHref(basePath: string, area: ReleaseNoteArea | null, page = 1): string {
  const query = new URLSearchParams()
  if (area) query.set('area', area)
  if (page > 1) query.set('page', String(page))
  const search = query.toString()
  return search ? `${basePath}?${search}` : basePath
}

export function WhatsNewList({ list, basePath = '/app/whats-new' }: WhatsNewListProps): JSX.Element {
  const t = useTranslations(whatsNewCopy)
  const { locale } = useLocale()
  return (
    <div className="flex flex-col gap-6">
      <AreaFilter list={list} basePath={basePath} t={t} />
      {list.weeks.length === 0 ? (
        <EmptyState icon={Sparkles} title={t('empty')} />
      ) : (
        list.weeks.map((week) => (
          <WeekCard key={week.id} week={week} filtered={list.area !== null} locale={locale} t={t} />
        ))
      )}
      <Pager list={list} basePath={basePath} t={t} />
    </div>
  )
}

function AreaFilter({ list, basePath, t }: { list: LocalizedReleaseNoteList; basePath: string; t: Translator }): JSX.Element {
  const areas = list.areas.filter((area) => area.count > 0)
  return (
    <nav aria-label={t('filterLabel')}>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Chip asChild interactive variant={list.area === null ? 'default' : 'outline'} size="md">
            <Link href={whatsNewHref(basePath, null)} aria-current={list.area === null ? 'page' : undefined}>
              {t('allAreas')}
            </Link>
          </Chip>
        </li>
        {areas.map((area) => (
          <li key={area.id}>
            <Chip asChild interactive variant={list.area === area.id ? 'default' : 'outline'} size="md">
              <Link href={whatsNewHref(basePath, area.id)} aria-current={list.area === area.id ? 'page' : undefined}>
                {t(`areas.${area.id}`)}
                <ChipCount>{area.count}</ChipCount>
              </Link>
            </Chip>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** "26 October – 1 November 2026", in the reader's language; a version shows as itself. */
export function weekTitle(week: LocalizedReleaseNoteWeek, locale: string, unreleased: string): string {
  if (week.kind === 'version' && week.version) return week.version
  if (!week.date) return unreleased
  const format = new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const start = new Date(`${week.date}T00:00:00Z`)
  return week.dateEnd ? format.formatRange(start, new Date(`${week.dateEnd}T00:00:00Z`)) : format.format(start)
}

function WeekCard({
  week,
  filtered,
  locale,
  t,
}: {
  week: LocalizedReleaseNoteWeek
  filtered: boolean
  locale: string
  t: Translator
}): JSX.Element {
  const headingId = `week-${week.id}`
  return (
    <Card aria-labelledby={headingId} role="region">
      <CardHeader>
        <CardTitle>
          <h2 id={headingId} className="text-base font-semibold">
            {week.date ? (
              <time dateTime={week.date}>{weekTitle(week, locale, t('unreleased'))}</time>
            ) : (
              weekTitle(week, locale, t('unreleased'))
            )}
          </h2>
        </CardTitle>
        {week.summary && <CardDescription className="max-w-prose">{week.summary}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {RELEASE_NOTE_SECTIONS.map((section) => {
          const notes = week.notes.filter((note) => note.section === section)
          if (notes.length === 0) return null
          return FOLDED.has(section) ? (
            <details key={section} className="group">
              <summary className="text-muted-foreground cursor-pointer text-sm font-medium">
                {t('fixesSummary', { count: notes.length })}
              </summary>
              <NoteItems notes={notes} showArea={!filtered} t={t} className="mt-3" />
            </details>
          ) : (
            <section key={section} aria-label={t(`sections.${section}`)}>
              <SectionLabel as="h3" className="mb-2">
                {t(`sections.${section}`)}
              </SectionLabel>
              <NoteItems notes={notes} showArea={!filtered} t={t} />
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}

function NoteItems({
  notes,
  showArea,
  t,
  className,
}: {
  notes: readonly LocalizedReleaseNote[]
  showArea: boolean
  t: Translator
  className?: string
}): JSX.Element {
  return (
    <ul className={`flex flex-col gap-2.5 ${className ?? ''}`}>
      {notes.map((note, index) => (
        <li key={index} className="flex flex-col gap-1 text-sm leading-relaxed sm:flex-row sm:items-baseline sm:gap-3">
          {showArea && (
            <Chip variant="muted" size="sm" className="sm:w-44 sm:shrink-0 sm:justify-center">
              {t(`areas.${note.area}`)}
            </Chip>
          )}
          <span className="min-w-0">{note.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Pager({ list, basePath, t }: { list: LocalizedReleaseNoteList; basePath: string; t: Translator }): JSX.Element | null {
  if (list.pageCount <= 1) return null
  return (
    <nav aria-label={t('pageLabel')} className="flex items-center justify-between gap-2">
      {list.page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={whatsNewHref(basePath, list.area, list.page - 1)}>
            <ChevronLeft className="size-4" aria-hidden />
            {t('newer')}
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {list.page < list.pageCount && (
        <Button asChild variant="outline" size="sm">
          <Link href={whatsNewHref(basePath, list.area, list.page + 1)}>
            {t('older')}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Button>
      )}
    </nav>
  )
}
