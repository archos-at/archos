'use client'

import type { JSX } from 'react'
import { FilePreviewPane } from '@/features/documents/components/file-preview-pane'
import { fakeFetch } from '../annotations/fake-annotation-api'
import { FakeTurnSocket, isTurnSocket } from '../annotations/fake-turn-socket'
import { FILE } from '../annotations/fixtures'
import { RoomEventSource } from '../annotations/room-event-source'
import { tapeFetch } from './fake-tape-api'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __tapeShim?: boolean; EventSource: unknown }
  if (!w.__tapeShim) {
    w.__tapeShim = true
    w.EventSource = RoomEventSource
    window.WebSocket = new Proxy(window.WebSocket, {
      construct: (target, args: ConstructorParameters<typeof WebSocket>) =>
        isTurnSocket(args[0]) ? new FakeTurnSocket(String(args[0])) : Reflect.construct(target, args),
    })
    const real = window.fetch.bind(window)
    window.fetch = tapeFetch(fakeFetch(real))
    const url = new URL(window.location.href)
    if (!url.searchParams.has('review')) {
      url.searchParams.set('review', '1')
      url.searchParams.set('doc', FILE.id)
      url.searchParams.set('tool', 'measure')
      window.history.replaceState(null, '', url)
    }
  }
}

export default function DrawingTapePreview(): JSX.Element {
  return (
    <main className="bg-muted/40 flex min-h-dvh items-center justify-center">
      <div className="bg-popover text-popover-foreground h-[85dvh] w-[min(1100px,calc(100%-2rem))] overflow-hidden rounded-2xl border shadow-lg phone:fixed phone:inset-0 phone:h-dvh phone:w-full phone:rounded-none phone:border-0">
        <FilePreviewPane
          file={FILE}
          projectId="proj-demo"
          projectName="Wohnbau Nord — Linz"
          canManage
          canCollaborate
          viewerUserId="u-1"
          onClose={() => {}}
        />
      </div>
    </main>
  )
}
