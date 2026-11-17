'use client'

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
      className="flex h-full min-h-0 flex-col outline-none"
      data-testid="inbox-dock"
      data-queue-keys=""
      onKeyDown={onKeyDown}
    >
      <header className="flex shrink-0 items-center gap-2 py-2.5 pr-2 pl-5">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-6">
        <InboxQueue returnHere={false} keyScope="self" />
      </div>
      <footer className="shrink-0 border-t px-3 py-2">
        <Link
          href="/app/inbox?filter=all"
          className="group/all flex items-center justify-between rounded-control px-2 py-1.5 text-xs text-muted-foreground transition-colors duration-snap hover:bg-hover hover:text-foreground motion-reduce:transition-none"
          data-testid="inbox-dock-all"
        >
          {t('inbox.dock.all')}
          <ArrowRight
            className="size-3.5 transition-transform duration-snap group-hover/all:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden
          />
        </Link>
      </footer>
    </aside>
  )
}
