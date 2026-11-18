'use client'

import type { JSX } from 'react'
import { FolderInput, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export interface SelectionBarProps {
  count: number
  total: number
  onSelectAll: () => void
  onMove: () => void
  onDone: () => void
  canMove: boolean
}

export function SelectionBar({
  count,
  total,
  onSelectAll,
  onMove,
  onDone,
  canMove,
}: SelectionBarProps): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <div
      className="bg-sheet shadow-md rounded-overlay animate-in fade-in-0 slide-in-from-bottom-2 duration-base mx-4 mb-[max(1rem,var(--shell-inset-bottom,env(safe-area-inset-bottom)))] shrink-0 py-2 ease-out motion-reduce:animate-none md:mx-8 md:max-w-[1216px] @min-[90rem]/section:mx-auto!"
      data-testid="selection-bar"
    >
      <div className="flex items-center gap-3 px-4" /* presses 12px apart, as every bar */>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-ml-2.5"
        onClick={onDone}
        aria-label={t('selection.done')}
        data-testid="selection-done"
      >
        <X aria-hidden />
      </Button>
      {/* The count, and „Alle auswählen“ as a text press after it (under it on a phone): it was a press of the move's
          weight, and on a phone the move lost its word to make room (review of 2026-11-10, finding 18). */}
      <div className="flex min-w-0 flex-1 items-center gap-x-3 phone:flex-col phone:items-start">
        <p
          className="whitespace-nowrap text-sm font-medium tabular-nums"
          role="status"
          data-testid="selection-count"
        >
          {t('selection.count', { count })}
        </p>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-auto px-0 py-0 font-normal phone:text-xs"
          onClick={onSelectAll}
          disabled={count >= total}
          data-testid="selection-all"
        >
          {t('selection.all')}
        </Button>
      </div>
      {canMove && (
        <Button
          type="button"
          size="sm"
          className="gap-2"
          onClick={onMove}
          disabled={count === 0}
          data-testid="selection-move"
        >
          <FolderInput className="size-4" aria-hidden />
          {t('selection.move')}
        </Button>
      )}
      </div>
    </div>
  )
}
