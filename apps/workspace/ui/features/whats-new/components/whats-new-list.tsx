'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Chip, ChipCount } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { useLocale, useTranslations, type Translator } from '@/i18n'
import { whatsNewCopy } from '@/i18n/namespaces/whats-new'
import type {
  LocalizedReleaseNote,
  LocalizedReleaseNoteList,
  LocalizedReleaseNoteWeek,
  ReleaseNoteArea,
  ReleaseNoteSection,
} from '@/lib/release-notes/release-notes-wire'
import { RELEASE_NOTE_AREAS, RELEASE_NOTE_SECTIONS } from '@/lib/release-notes/release-notes-wire'
import {
  AreaFilterRow,
  AreaGroup,
  AreaGroups,
  ChangeItem,
  ChangeList,
  ChangeSectionHeader,
  ChangeSections,
  Fold,
  WeekEntry,
  WeekHeading,
  WeekLede,
  WeekTally,
  WeekTallyItem,
  WeekTimeline,
} from './whats-new-atoms'

const FOLDED: ReadonlySet<ReleaseNoteSection> = new Set(['fixes'])

export interface WhatsNewListProps {
  list: LocalizedReleaseNoteList
  basePath?: string
  query?: Readonly<Record<string, string>>
}

export function whatsNewHref(
  basePath: string,
  area: ReleaseNoteArea | null,
  cursor: string | null = null,
  keep: Readonly<Record<string, string>> = {},
): string {
  const query = new URLSearchParams(keep)
  if (area) query.set('area', area)
  if (cursor) query.set('cursor', cursor)
  const search = query.toString()
  return search ? `${basePath}?${search}` : basePath
}

interface Address {
  basePath: string
  keep: Readonly<Record<string, string>>
}

export function WhatsNewList({ list, basePath = '/app/whats-new', query = {} }: WhatsNewListProps): JSX.Element {
  const t = useTranslations(whatsNewCopy)
  const { locale } = useLocale()
  const address: Address = { basePath, keep: query }
  const filtered = list.area !== null
  return (
    <div className="flex flex-col gap-8">
      <AreaFilter list={list} address={address} t={t} />
      {list.weeks.length === 0 ? (
        <EmptyState icon={Sparkles} title={t('empty')} />
      ) : (
        <WeekTimeline>
          {list.weeks.map((week, index) => (
            <Week
              key={week.id}
              week={week}
              filtered={filtered}
              open={filtered || (index === 0 && list.cursor === null)}
              locale={locale}
              t={t}
            />
          ))}
        </WeekTimeline>
      )}
      <Pager list={list} address={address} t={t} />
    </div>
  )
}

function AreaFilter({ list, address, t }: { list: LocalizedReleaseNoteList; address: Address; t: Translator }): JSX.Element {
  const areas = list.areas.filter((area) => area.count > 0)
  const href = (area: ReleaseNoteArea | null): string => whatsNewHref(address.basePath, area, null, address.keep)
  return (
    <nav aria-label={t('filterLabel')}>
      <AreaFilterRow aria-label={t('filterLabel')}>
        <li>
          <Chip asChild interactive variant={list.area === null ? 'default' : 'outline'} size="md">
            <Link href={href(null)} aria-current={list.area === null ? 'page' : undefined}>
              {t('allAreas')}
            </Link>
          </Chip>
        </li>
        {areas.map((area) => (
          <li key={area.id}>
            <Chip asChild interactive variant={list.area === area.id ? 'default' : 'outline'} size="md">
              <Link href={href(area.id)} aria-current={list.area === area.id ? 'page' : undefined}>
                {t(`areas.${area.id}`)}
                <ChipCount>{area.count}</ChipCount>
              </Link>
            </Chip>
          </li>
        ))}
      </AreaFilterRow>
    </nav>
  )
}

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

export function groupByArea(
  notes: readonly LocalizedReleaseNote[],
): { area: ReleaseNoteArea; notes: LocalizedReleaseNote[] }[] {
  return RELEASE_NOTE_AREAS.map((area) => ({ area, notes: notes.filter((note) => note.area === area) })).filter(
    (group) => group.notes.length > 0,
  )
}

function Week({
  week,
  filtered,
  open,
  locale,
  t,
}: {
  week: LocalizedReleaseNoteWeek
  filtered: boolean
  open: boolean
  locale: string
  t: Translator
}): JSX.Element {
  const headingId = `week-${week.id}`
  const title = weekTitle(week, locale, t('unreleased'))
  const sections = RELEASE_NOTE_SECTIONS.map((section) => ({
    section,
    notes: week.notes.filter((note) => note.section === section),
  })).filter((entry) => entry.notes.length > 0)
  return (
    <WeekEntry
      aria-labelledby={headingId}
      rail={
        <>
          <WeekHeading id={headingId}>{week.date ? <time dateTime={week.date}>{title}</time> : title}</WeekHeading>
          <WeekTally>
            {sections.map(({ section, notes }) => (
              <WeekTallyItem key={section} count={notes.length}>
                {t(`sections.${section}`)}
              </WeekTallyItem>
            ))}
          </WeekTally>
        </>
      }
    >
      {week.summary && <WeekLede>{week.summary}</WeekLede>}
      <Fold open={open} label={t('noteCount', { count: week.notes.length })}>
        <ChangeSections className="mt-5">
          {sections.map(({ section, notes }) =>
            FOLDED.has(section) ? (
              <Fold key={section} open={sections.length === 1} label={t('fixesSummary', { count: notes.length })}>
                <Changes notes={notes} byArea={!filtered} t={t} />
              </Fold>
            ) : (
              <section key={section} aria-label={t(`sections.${section}`)}>
                <ChangeSectionHeader count={notes.length}>{t(`sections.${section}`)}</ChangeSectionHeader>
                <Changes notes={notes} byArea={!filtered} t={t} />
              </section>
            ),
          )}
        </ChangeSections>
      </Fold>
    </WeekEntry>
  )
}

function Changes({
  notes,
  byArea,
  t,
}: {
  notes: readonly LocalizedReleaseNote[]
  byArea: boolean
  t: Translator
}): JSX.Element {
  if (!byArea) {
    return (
      <AreaGroup>
        <NoteItems notes={notes} />
      </AreaGroup>
    )
  }
  return (
    <AreaGroups>
      {groupByArea(notes).map((group) => (
        <AreaGroup key={group.area} label={t(`areas.${group.area}`)}>
          <NoteItems notes={group.notes} />
        </AreaGroup>
      ))}
    </AreaGroups>
  )
}

function NoteItems({ notes }: { notes: readonly LocalizedReleaseNote[] }): JSX.Element {
  return (
    <ChangeList>
      {notes.map((note, index) => (
        <ChangeItem key={index}>{note.text}</ChangeItem>
      ))}
    </ChangeList>
  )
}

function Pager({ list, address, t }: { list: LocalizedReleaseNoteList; address: Address; t: Translator }): JSX.Element | null {
  if (!list.cursor && !list.nextCursor) return null
  return (
    <nav aria-label={t('pageLabel')} className="flex items-center justify-between gap-2">
      {list.cursor ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={whatsNewHref(address.basePath, list.area, null, address.keep)}>
            <ChevronLeft className="size-4" aria-hidden />
            {t('newer')}
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {list.nextCursor && (
        <Button asChild variant="secondary" size="sm">
          <Link href={whatsNewHref(address.basePath, list.area, list.nextCursor, address.keep)}>
            {t('older')}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Button>
      )}
    </nav>
  )
}
