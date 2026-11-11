'use client'

import type { JSX } from 'react'
import { FolderInput, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'

export interface SelectionBarProps {
  /** How many documents are picked. */
  count: number
  /** How many the level holds, so „Alle" can say it is already everything. */
  total: number
  onSelectAll: () => void
  onMove: () => void
  /** Leave the selection mode. */
  onDone: () => void
  /** Moving is out of reach on a level the reader may only read. */
  canMove: boolean
}

/**
 * What can be done to the documents picked, at the foot of the listing.
 *
 * In flow at the bottom of the workspace and not `fixed`: the phone's tab bar
 * is in flow under the page, so this sits on top of it with no height to guess
 * and no home-indicator inset to double up on. The thumb is at the bottom of the
 * screen; the controls are there. The count is announced as a status because it
 * is the one thing that changes on every tap.
 */
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
    // While picking, a white bar floats 16px off the foot: elevation 2, the overlay radius (paper on a desk).
    // Its content keeps the listing's container, on the column's left edge as `listing-container` is (centred only from a
    // 90rem section; centred always, it stood 74px right of the tiles at 1700px); the ✕ gives back its inset.
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
          // Never cut: on a phone the count was „2 a…“ beside two labelled presses.
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
