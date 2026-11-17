'use client'

import { useEffect, useRef, type JSX } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { noteViewerLocation, noteViewerRoom, registerViewerActionRunner } from '@/features/chat/lib/viewer-actions'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { createViewerActionRunner } from '../lib/viewer-action-runner'
import { peekHasRoom } from '../lib/peek-room'
import { useRevisionCompare } from './revision-compare'

export function ViewerActionHost(): JSX.Element | null {
  const router = useRouter()
  const pathname = usePathname()
  const isMobile = useIsMobile()
  const { openRevisionCompare, closeRevisionCompare, compareElement } = useRevisionCompare()
  const room = useRef(false)
  room.current = peekHasRoom(pathname, isMobile)

  useEffect(
    () =>
      registerViewerActionRunner(
        createViewerActionRunner({
          hasRoom: () => room.current,
          openCompare: openRevisionCompare,
          closeCompare: closeRevisionCompare,
          navigate: (href) => router.push(href),
          currentHref: () => `${window.location.pathname}${window.location.search}`,
        })
      ),
    [openRevisionCompare, closeRevisionCompare, router]
  )

  const hasRoom = room.current
  useEffect(() => noteViewerRoom(hasRoom), [hasRoom])
  useEffect(() => noteViewerLocation(), [pathname])

  return compareElement
}
