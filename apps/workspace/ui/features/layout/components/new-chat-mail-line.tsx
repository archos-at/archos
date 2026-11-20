'use client'

import type { JSX } from 'react'
import { InboundMailWaitingLine } from '@/features/documents'
import { useInboundMailWaitingShown } from '@/hooks/use-inbound-mail-waiting'
import { inboundMailPaths } from '@/lib/inbound-mail/paths'

export function NewChatMailLine({ projectId }: { projectId: string | null }): JSX.Element | null {
  const waiting = useInboundMailWaitingShown(projectId)
  const count = waiting.count ?? 0
  if (!projectId || count === 0) return null
  return (
    <div className="mt-2 flex justify-center" data-testid="new-chat-mail-line">
      <InboundMailWaitingLine
        href={inboundMailPaths(projectId).list({ status: 'waiting', outcome: null })}
        count={count}
        more={waiting.more}
      />
    </div>
  )
}
