import { type FC, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import type { CitationSource } from '../../types'

const MAX_READ_SOURCES = 8

export const wireCitationNumbers = (citations: CitationSource[] | undefined): number[] =>
  (citations ?? []).flatMap((citation) =>
    typeof citation.number === 'number' ? [citation.number] : []
  )

export function readSourceLabel(source: CitationSource): string | undefined {
  return source.fileName ?? source.title ?? source.citationKey
}

export const ReadSourcesSection: FC<{ readSources?: CitationSource[] }> = ({ readSources }) => {
  const t = useTranslations(chatCopy)
  const [expanded, setExpanded] = useState(false)
  const named = useMemo(
    () =>
      (readSources ?? []).flatMap((source) => {
        const label = readSourceLabel(source)
        return label === undefined ? [] : [{ source, label }]
      }),
    [readSources]
  )
  if (named.length === 0) return null
  const visible = expanded ? named : named.slice(0, MAX_READ_SOURCES)
  const hidden = named.length - visible.length

  return (
    <div className="flex flex-col gap-1.5" data-testid="read-sources">
      <SectionLabel>{t('answerDetails.readSources.label')}</SectionLabel>
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="list"
        aria-label={t('answerDetails.readSources.label')}
      >
        {visible.map(({ source, label }) => (
          <span key={source.id} role="listitem">
            <Chip size="sm" variant="muted" data-testid="read-source-chip">
              <FileText aria-hidden />
              {label}
              {typeof source.page === 'number' && (
                <span className="opacity-80">{t('answerSources.page', { page: source.page })}</span>
              )}
            </Chip>
          </span>
        ))}
        {named.length > MAX_READ_SOURCES && (
          <button data-attr="read-sources-more"
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            data-testid="read-sources-more"
            className="text-muted-foreground duration-quick hover:text-foreground focus-visible:ring-ring/60 cursor-pointer rounded-control text-xs leading-relaxed underline decoration-dotted underline-offset-2 transition-colors ease-out focus-visible:ring-2 focus-visible:outline-none"
          >
            {expanded
              ? t('answerDetails.readSources.less')
              : t('answerDetails.readSources.more', { count: hidden })}
          </button>
        )}
      </div>
    </div>
  )
}
