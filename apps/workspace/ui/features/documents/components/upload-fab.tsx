import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The phone's Hochladen: the uploader's own button, lifted to a floating
 * action at the foot of the screen. The wrapper sizes it and lets only the
 * button take touches, so the list under the rest of the strip still scrolls.
 *
 * `inSheet` is the Archiv, a sheet that reaches the screen's edge and so clears
 * the home indicator itself; a project's Dateien sits above the in-flow tab bar,
 * which owns that inset. The nearest positioned ancestor is the box it floats in.
 */
export function UploadFab({ inSheet, children }: { inSheet: boolean; children: ReactNode }): JSX.Element {
  return (
    <div
      className={cn(
        // A 56px round glyph at elevation 2 (a floating bar's; 3 is a dialog's): the worded 48px bar covered a thumbnail.
        // Not while an empty level's own Hochladen shows: that is the pane's one ink press (one primary per pane).
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
