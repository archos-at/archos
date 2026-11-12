'use client'

/**
 * A standard's facts beside its file, first in the viewer's details column: its
 * edition and since when it applies, whether it is confirmed, whether its text
 * is read, and when it was last checked. The two things a person does in
 * passing are here (confirm a proposal, say it is still current); everything
 * else about the standard is one press away („Angaben bearbeiten“), never in
 * the way of reading it.
 */

import { useState, type JSX } from 'react'
import { BookOpen, CalendarCheck, CircleCheck, History, Layers, Library, ScanText, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { recordBaseKnowledgeCheck, type BaseKnowledgeEntry } from '@/adapters/api/base-knowledge-client'
import { Button } from '@/components/ui/button'
import { InspectorGroup, InspectorRow, InspectorSection } from '@/components/ui/inspector-group'
import { useLocale, useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { day, LastChecked, StatusChip, superseded, TextUseChip } from './entry-atoms'

interface StandardFactsProps {
  entry: BaseKnowledgeEntry
  canManage: boolean
  /** To the standard's page, where its values, licence, editions and folder are changed. */
  onManage: () => void
  /** Another edition of the same standard, opened as its file. */
  onOpenEdition: (entryId: string) => void
  onChanged: (entry: BaseKnowledgeEntry) => void
}

export function StandardFacts({ entry, canManage, onManage, onOpenEdition, onChanged }: StandardFactsProps): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { locale } = useLocale()
  const [busy, setBusy] = useState(false)
  const own = entry.editions.find((edition) => edition.id === entry.id)
  const others = entry.editions.filter((edition) => edition.id !== entry.id)

  const check = async () => {
    setBusy(true)
    try {
      onChanged(await recordBaseKnowledgeCheck(entry.id, { result: 'current' }))
      toast.success(t('facts.checked'))
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <InspectorSection
      label={t('facts.title')}
      icon={Library}
      action={
        canManage ? (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onManage} data-testid="standard-facts-manage">
            {t('facts.manage')}
          </Button>
        ) : undefined
      }
      data-testid="standard-facts"
    >
      <InspectorGroup>
        {entry.values.designation && (
          <InspectorRow label={t('facts.designation')} icon={Tag}>
            {entry.values.designation}
          </InspectorRow>
        )}
        <InspectorRow label={t('column.edition')} icon={BookOpen}>
          {entry.values.editionLabel}
        </InspectorRow>
        {own?.startsOn && (
          <InspectorRow label={t('field.inForceFrom')} icon={CalendarCheck}>
            {day(own.startsOn, locale)}
          </InspectorRow>
        )}
        <InspectorRow label={t('column.status')} icon={CircleCheck}>
          <StatusChip entry={entry} />
        </InspectorRow>
        <InspectorRow label={t('column.text')} icon={ScanText}>
          <TextUseChip entry={entry} />
        </InspectorRow>
        <InspectorRow label={t('column.checked')} icon={History}>
          <LastChecked entry={entry} locale={locale} />
        </InspectorRow>
        {others.length > 0 && (
          <InspectorRow label={t('detail.editions')} icon={Layers}>
            <span className="flex flex-col items-end gap-1">
              {others.map((edition) => (
                <button
                  key={edition.id}
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenEdition(edition.id)}
                >
                  {t('detail.editionLine', { label: edition.editionLabel })}
                </button>
              ))}
            </span>
          </InspectorRow>
        )}
      </InspectorGroup>
      {canManage && entry.status === 'proposed' && (
        <Button size="sm" className="mt-2 self-start" onClick={onManage} data-testid="standard-facts-confirm">
          {t('facts.reviewAndConfirm')}
        </Button>
      )}
      {/* A superseded edition is not checked: the newer one is what a check would find. */}
      {canManage && entry.status === 'confirmed' && !superseded(entry) && (
        <Button size="sm" variant="secondary" className="mt-2 self-start" disabled={busy} onClick={() => void check()} data-testid="standard-facts-check">
          {t('detail.checkCurrent')}
        </Button>
      )}
    </InspectorSection>
  )
}
