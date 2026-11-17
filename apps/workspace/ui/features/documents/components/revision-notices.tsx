'use client'

import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { RevisionLinks } from '@/lib/documents/revision-links'

export function SuggestionNotice({
  suggestion,
  canManage,
  busy,
  onDecide,
}: {
  suggestion: NonNullable<RevisionLinks['suggestion']>
  canManage: boolean
  busy: boolean
  onDecide: (olderId: string, linked: boolean) => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed px-3 py-2.5" data-testid="revision-suggestion">
      <p className="text-foreground text-[13px] leading-snug">{t('preview.revision.suggestion', { name: suggestion.of.filename })}</p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(BASIS_KEY[suggestion.basis])}
        {suggestion.reason ? ` ${suggestion.reason}` : ''}
      </p>
      {canManage ? (
        <div className="flex flex-wrap gap-3">
          <Button type="button" size="sm" disabled={busy} onClick={() => onDecide(suggestion.of.id, true)}>
            {t('preview.revision.confirm')}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(suggestion.of.id, false)}>
            {t('preview.revision.dismiss')}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t('preview.revision.askEditor')}</p>
      )}
    </div>
  )
}

const BASIS_KEY: Record<NonNullable<RevisionLinks['suggestion']>['basis'], string> = {
  title_block: 'preview.revision.basisTitleBlock',
  name: 'preview.revision.basisName',
  content: 'preview.revision.basisContent',
}
