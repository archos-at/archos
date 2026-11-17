'use client'

import type { FC } from 'react'

import { ConnectionBand } from '@/components/shell/connection-band'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { cn } from '@/lib/utils'

export const ChatConnectionLine: FC<{ className?: string }> = ({ className }) => {
  const isMobile = useIsMobile()
  return (
    <div data-testid="chat-connection-line" className={cn('pointer-events-none flex flex-col md:hidden', className)}>
      {isMobile && <ConnectionBand appearance="line" />}
    </div>
  )
}
