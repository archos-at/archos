'use client'

import type { JSX } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'

export interface InvokedSkillChipProps {
  name: string
  description: string
  onRemove?: () => void
}

export function InvokedSkillChip({
  name,
  description,
  onRemove,
}: InvokedSkillChipProps): JSX.Element {
  const t = useTranslations(skillsCopy)

  return (
    <div
      data-testid="invoked-skill-chip"
      className="border-primary/20 bg-primary/5 animate-in fade-in-0 mt-2 flex items-start gap-2.5 rounded-lg border px-2.5 py-2 duration-base ease-out motion-reduce:animate-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The name in the form the user typed it. No icon: there is exactly one
            of these at a time and the line already says what it is, so a glyph
            would decorate rather than distinguish — the same reason the picker
            rows carry none. */}
        <span className="text-foreground truncate text-xs">
          <span className="text-muted-foreground">{t('composer.invoked.label')}</span>{' '}
          <span className="font-mono">/{name}</span>
        </span>
        {/* The description first — it is what confirms the right skill was
            picked — then the mechanism, which is the same for every skill and so
            reads as a footnote rather than as news. */}
        <span className="text-muted-foreground line-clamp-2 text-xs leading-snug">
          {description}
        </span>
        <span className="text-muted-foreground text-xs leading-snug">
          {t('composer.invoked.hint')}
        </span>
      </span>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('composer.invoked.remove', { name })}
          className="focus-visible:ring-ring/60 text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1 transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 pointer-coarse:inline-flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center pointer-coarse:p-0"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
