'use client'

import type { JSX } from 'react'
import { FilePreviewPane } from '@/features/documents/components/file-preview-pane'
import { fakeFetch } from './fake-annotation-api'
import { FakeTurnSocket, isTurnSocket } from './fake-turn-socket'
import { FILE } from './fixtures'
import { RoomEventSource } from './room-event-source'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __annotationsShim?: boolean; EventSource: unknown }
  if (!w.__annotationsShim) {
    w.__annotationsShim = true
    w.EventSource = RoomEventSource
    window.WebSocket = new Proxy(window.WebSocket, {
      construct: (target, args: ConstructorParameters<typeof WebSocket>) =>
        isTurnSocket(args[0]) ? new FakeTurnSocket(String(args[0])) : Reflect.construct(target, args),
    })
    const real = window.fetch.bind(window)
    window.fetch = fakeFetch(real)
  }
}

export default function AnnotationsPreview(): JSX.Element {
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
