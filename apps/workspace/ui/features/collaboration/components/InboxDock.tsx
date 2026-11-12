'use client'

/**
 * The Postfach docked beside the page (ADR-0148): the queue, worked next to
 * the real places its entries open.
 *
 * Following an entry replaces the page beside the dock with the entry's own
 * place (the chat at the message, the review at the mark) and the dock stays,
 * so the next entry is one click away and nothing is ever shown twice. The
 * shell owns where it sits and how wide it is (`startDock`, `DockedSplit`);
 * this is only what is in it.
 *
 * It behaves as the disclosure its door says it is (`aria-expanded`): opened
 * by the reader, it takes the focus, so j/k work at once; Escape puts it away
 * and hands the focus back to the door. Restored after a reload it leaves the
 * focus where the page has it. A click anywhere in it focuses it too, so its
 * keys never wait for a Tab.
 *
 * It slides in and out with the panel it sits in (`DockedSplit`), as one
 * drawer; it adds no motion of its own.
 *
 * It is a sheet lying on the desk, with a sheet's one edge (owner decision
 * 2026-11-12): set in the desk's own grey it ran into the rail beside it, with
 * nothing to say where the rail ended and the Postfach began. The desk shows
 * round it, so it reads as a thing of its own whether or not the rail draws an
 * edge. Its header and its foot stand still; the queue scrolls between them.
 *
 * Everything the queue cannot show (the whole history, the archive) is one
 * link away at its foot.
 */

import type { JSX, KeyboardEvent } from 'react'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight, X } from 'lucide-react'

import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { Button } from '@/components/ui/button'
import { focusStartDockDoor, useStartDock } from '@/components/shell/start-dock'
import { InboxQueue } from './InboxQueue'

export function InboxDock(): JSX.Element {
  const t = useTranslations(collaborationCopy)
  const close = useStartDock((state) => state.close)
  const takesFocus = useStartDock((state) => state.takesFocus)
  const focusTaken = useStartDock((state) => state.focusTaken)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!takesFocus) return
    rootRef.current?.focus({ preventScroll: true })
    focusTaken()
  }, [takesFocus, focusTaken])

  const putAway = (): void => {
    close()
    focusStartDockDoor('inbox')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    putAway()
  }

  return (
    <aside
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby="inbox-dock-title"
      className="flex h-full min-h-0 flex-col p-2 outline-none"
      data-testid="inbox-dock"
      data-queue-keys=""
      onKeyDown={onKeyDown}
    >
      <div className="bg-sheet flex min-h-0 flex-1 flex-col overflow-hidden rounded-surface shadow-sm" data-slot="inbox-dock-sheet">
      <header className="flex shrink-0 items-center gap-2 border-b py-2 pr-2 pl-4">
        <h2 id="inbox-dock-title" className="text-sm font-medium">
          {t('inbox.title')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-7 text-muted-foreground"
          aria-label={t('inbox.dock.close')}
          title={t('inbox.dock.close')}
          onClick={putAway}
          data-testid="inbox-dock-close"
        >
          <X aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-6">
        <InboxQueue returnHere={false} keyScope="self" />
      </div>
      <footer className="shrink-0 border-t px-2 py-2">
        <Link
          href="/app/inbox?filter=all"
          className="group/all flex items-center justify-between rounded-control px-2 py-1.5 text-xs text-muted-foreground transition-colors duration-snap hover:bg-muted hover:text-foreground motion-reduce:transition-none"
          data-testid="inbox-dock-all"
        >
          {t('inbox.dock.all')}
          <ArrowRight
            className="size-3.5 transition-transform duration-snap group-hover/all:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden
          />
        </Link>
      </footer>
      </div>
    </aside>
  )
}
