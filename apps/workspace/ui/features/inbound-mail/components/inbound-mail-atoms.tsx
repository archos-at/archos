'use client'

/**
 * The E-Mail-Eingang's own atoms: the few shapes its organisms repeat, written
 * once so the list, the detail and the decision bar are made of the same
 * material (`design-language.md`, „Component layers“).
 *
 * - `FactLine` (from the kit, `components/ui/fact-line.tsx`): one fact about a
 *   mail or a part, a glyph and words; `warning` and `danger` colour the
 *   glyph, never the words.
 * - `CheckLine`: a checkbox with its sentence, for the person's explicit yes
 *   („Trotzdem ablegen“). The whole line is the label (the kit's `Label`),
 *   44px under a finger.
 * - `PinnedBar`: the decision's edge, pinned to the bottom of the detail and
 *   padded past the home indicator; the decision bar and the claimed-mail bar
 *   both stand on it.
 * - `QuietPanel`: a block that belongs together inside the detail (the
 *   address, the „Details“ of a mail, a calendar invitation, what can be
 *   restored): a quiet tint and one hairline on the surface radius.
 */

import type { HTMLAttributes, JSX, ReactNode } from 'react'
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export { FactLine, type FactTone } from '@/components/ui/fact-line'

export function CheckLine({
  checked,
  onCheckedChange,
  disabled,
  children,
  className,
  testId,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
  className?: string
  testId?: string
}): JSX.Element {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2 text-xs pointer-coarse:min-h-11 pointer-coarse:items-center', className)}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        data-testid={testId}
        className="mt-px pointer-coarse:mt-0"
      />
      <Label htmlFor={id} className="cursor-pointer text-xs leading-snug font-normal">
        {children}
      </Label>
    </div>
  )
}

/**
 * The bottom edge of the detail: pinned, a frosted strip of the page's paper with the home indicator's inset
 * below it. No rule on top: the material (blur, and a soft shadow cast upward over what scrolls under it) ends
 * the text, as a floating toolbar does.
 */
export function PinnedBar({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'bg-sheet/95 supports-[backdrop-filter]:bg-sheet/80 sticky bottom-0 z-10 flex flex-col gap-2 px-4 pt-3 shadow-pinned-foot backdrop-blur sm:px-8',
        // The page's 16px gutter on a phone; 24px under the presses on a desk, not 12 against 32 at the sides.
        'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6',
        className
      )}
      {...props}
    />
  )
}

/**
 * An aside of the reader (the header's details, a calendar invitation, what can still be restored): set off by a
 * 2px edge rule on its left and 12px of indent, as a quote is, never a grey box on the white reader (paper on a desk,
 * principle 1: a grey box on paper is no surface, and a box on a sheet is a box in a box).
 */
export function QuietPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('border-edge flex flex-col gap-2 border-l-2 py-0.5 pl-3', className)} {...props} />
}
