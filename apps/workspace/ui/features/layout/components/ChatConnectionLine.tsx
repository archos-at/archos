'use client'

import type { FC } from 'react'

import { ConnectionBand } from '@/components/shell/connection-band'
import { MobileLayoutOnly } from '@/components/ui/layout-only'
import { cn } from '@/lib/utils'

export const ChatConnectionLine: FC<{ className?: string }> = ({ className }) => (
  <div data-testid="chat-connection-line" className={cn('pointer-events-none flex flex-col md:hidden', className)}>
    <MobileLayoutOnly>
      <ConnectionBand appearance="line" />
    </MobileLayoutOnly>
  </div>
)
