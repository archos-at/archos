'use client'

import type { JSX, ReactNode } from 'react'

import { CommandHints, type CommandHintLabels } from '@/components/ui/command'

export function ComposerPickerFrame({ children, hints, testId }: { children: ReactNode; hints: CommandHintLabels; testId?: string }): JSX.Element {
  return (
    <div
      className="flex max-h-[360px] w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-1 duration-snap ease-out motion-reduce:animate-none"
      data-testid={testId}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <CommandHints labels={hints} className="pointer-coarse:hidden" />
    </div>
  )
}

export const COMPOSER_COMMAND_CLASS =
  'bg-transparent [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:size-4'
