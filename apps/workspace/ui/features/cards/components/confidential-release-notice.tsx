'use client'

import { useId, useState, type FC } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { StackedLabel } from '@/components/ui/stacked-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { ConfidentialSource, DraftFiling } from '../hooks/use-draft-filing'
import { DRAFT_ACTION } from './draft-filing-parts'

function useSourceLabel(): (source: ConfidentialSource) => string {
  const t = useTranslations(chatCopy)
  return (source) =>
    source.kind === 'project'
      ? t('cards.documentDraft.release.project', { name: source.name })
      : source.project
        ? t('cards.documentDraft.release.folderIn', { name: source.name, project: source.project })
        : t('cards.documentDraft.release.folder', { name: source.name })
}

export const ConfidentialReleaseNotice: FC<{ filing: DraftFiling }> = ({ filing }) => {
  const t = useTranslations(chatCopy)
  const label = useSourceLabel()
  const [checked, setChecked] = useState(false)
  const confirmId = useId()
  const { releaseSources, isFiling } = filing
  if (!releaseSources || filing.shownFiled) return null
  const blocked = !checked || isFiling
  return (
    <Alert variant="warning" data-testid="draft-confidential-release">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle className="text-foreground">{t('cards.documentDraft.release.title')}</AlertTitle>
      <AlertDescription className="gap-2">
        <p>{t('cards.documentDraft.release.body')}</p>
        <ul className="list-disc pl-4" data-testid="draft-confidential-sources">
          {releaseSources.map((source) => (
            <li key={`${source.kind}:${source.project ?? ''}:${source.name}`}>{label(source)}</li>
          ))}
        </ul>
        <label htmlFor={confirmId} className="flex items-start gap-2 text-foreground">
          <Checkbox
            id={confirmId}
            checked={checked}
            onCheckedChange={(next) => setChecked(next === true)}
            disabled={isFiling}
            className="mt-0.5"
            data-testid="draft-confidential-confirm"
          />
          <span>{t('cards.documentDraft.release.confirm')}</span>
        </label>
        <p className="flex flex-wrap items-center gap-x-3">
          <button
            type="button"
            className={DRAFT_ACTION}
            aria-disabled={blocked || undefined}
            aria-busy={isFiling || undefined}
            onClick={() => {
              if (!blocked) void filing.release()
            }}
            data-testid="draft-confidential-file"
          >
            <StackedLabel busy={isFiling} idle={t('cards.documentDraft.release.file')} working={t('cards.documentDraft.filing')} />
          </button>
          <button type="button" className={DRAFT_ACTION} onClick={filing.keepConfidential} disabled={isFiling}>
            {t('cards.documentDraft.release.keep')}
          </button>
        </p>
      </AlertDescription>
    </Alert>
  )
}
