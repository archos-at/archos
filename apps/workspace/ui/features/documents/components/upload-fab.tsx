import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function UploadFab({ inSheet, children }: { inSheet: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      className={cn(
        '[:has([data-empty-level])>&]:hidden',
        'pointer-events-none absolute right-4 z-20 [&_button]:pointer-events-auto [&_button]:size-14 [&_button]:rounded-full [&_button]:px-0 [&_button]:shadow-md [&_button_svg]:size-5',
        inSheet ? 'bottom-[max(1rem,env(safe-area-inset-bottom))]' : 'bottom-4'
      )}
      data-testid="files-upload-fab"
    >
      {children}
    </div>
  )
}
