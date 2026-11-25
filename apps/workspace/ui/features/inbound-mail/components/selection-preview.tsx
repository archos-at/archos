'use client'

import type { JSX } from 'react'
import { CircleAlert, MousePointerClick } from 'lucide-react'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations, type Translator } from '@/i18n'
import type { InboundMailSummaryView } from '@/lib/inbound-mail/inbound-mail-wire'
import { displaySubject } from '@/lib/inbound-mail/subject'
import { fileableReason } from '../lib/completeness'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

interface Group {
  place: string
  subjects: string[]
}

export function previewGroups(mails: readonly InboundMailSummaryView[], t: Translator): { groups: Group[]; held: string[] } {
  const groups = new Map<string, string[]>()
  const held: string[] = []
  const add = (place: string, subject: string): void => {
    const list = groups.get(place) ?? []
    if (!list.includes(subject)) list.push(subject)
    groups.set(place, list)
  }
  for (const mail of mails) {
    const subject = displaySubject(mail.subject) ?? t('row.noSubject')
    if (fileableReason(mail) !== null) {
      held.push(subject)
      continue
    }
    const places = mail.suggestedPlaces
    if (places?.text?.kind === 'thread') add(t('bulk.preview.thread', { name: places.text.name }), subject)
    if (places?.text?.kind === 'new_thread') add(t('bulk.preview.newThread'), subject)
    if (places && places.files > 0) for (const folder of places.folders) add(folder === '' ? t('suggestion.root') : folder, subject)
  }
  return { groups: [...groups.entries()].map(([place, subjects]) => ({ place, subjects })), held }
}

/** While mails are picked the reader says what the bar would do with them: where each goes, and which stay. */
export function SelectionPreview({ mails }: { mails: readonly InboundMailSummaryView[] }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { groups, held } = previewGroups(mails, t)
  const ready = mails.length - held.length
  if (mails.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center" data-testid="selection-preview">
        <MousePointerClick className="size-5" aria-hidden />
        <p className="max-w-xs text-sm text-balance">{t('bulk.preview.empty')}</p>
      </div>
    )
  }
  return (
    <div className="flex max-w-[720px] flex-col gap-6 p-4 sm:px-8 sm:py-6" data-testid="selection-preview">
      <h2 className="text-title font-medium">{held.length === 0 ? t('bulk.preview.title', { count: ready }) : t('bulk.preview.titleSome', { count: ready, total: mails.length })}</h2>
      {groups.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={t('bulk.preview.where')}>
          <SectionLabel as="h3">{t('bulk.preview.where')}</SectionLabel>
          <ul className="flex flex-col" data-testid="selection-preview-groups">
            {groups.map((group) => (
              <li key={group.place} className="flex flex-col gap-1 py-2 first:pt-0">
                <span className="text-sm font-medium">{t('row.dest', { place: group.place })}</span>
                <span className="text-muted-foreground text-xs text-pretty">{group.subjects.map((subject) => t('row.quoted', { name: subject })).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {held.length > 0 && (
        <p className="text-foreground flex items-start gap-2 text-sm text-pretty" data-testid="selection-preview-held">
          <CircleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('bulk.preview.held', { count: held.length, names: held.map((subject) => t('row.quoted', { name: subject })).join(', ') })}</span>
        </p>
      )}
    </div>
  )
}
