'use client'

import { CircleHelp, MessageSquareText, TriangleAlert } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { ANNOTATION_KINDS, type AnnotationKind } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'

export const KIND_ICONS: Record<AnnotationKind, typeof TriangleAlert> = {
  hint: MessageSquareText,
  question: CircleHelp,
  defect: TriangleAlert,
}

export function KindPicker({ value, onChange }: { value: AnnotationKind; onChange: (kind: AnnotationKind) => void }) {
  const t = useTranslations(filesCopy)
  return (
    <div role="group" aria-label={t('annotations.kind')} className="bg-muted inline-flex rounded-control p-0.5">
      {ANNOTATION_KINDS.map((kind) => {
        const Icon = KIND_ICONS[kind]
        const on = kind === value
        return (
          <button data-attr="files-change"
            key={kind}
            type="button"
            aria-pressed={on}
            data-testid={`thread-kind-${kind}`}
            onClick={() => onChange(kind)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px] font-medium transition-colors duration-quick ease-out',
              on ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-3" aria-hidden />
            {t(`annotations.kinds.${kind}`)}
          </button>
        )
      })}
    </div>
  )
}
