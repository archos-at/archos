'use client'

/**
 * A value that is too long to fit and too exact to abbreviate.
 *
 * An IFC GlobalId is 22 characters of base64, a type name can be a sentence,
 * and both used to end in an ellipsis whose full text was a `title` attribute.
 * A `title` needs a hover, and a phone has none — so on site the one string an
 * architect actually copies into a mail or a BCF topic was cut off with no way
 * to read the rest.
 *
 * So the value wraps (`break-all`: an id has no word boundaries to break at)
 * and a tap copies it. The copy is the useful half: nobody reads 22 random
 * characters, they paste them.
 *
 * A value that has places to break, an email address, shows itself through
 * `children` with those places marked (`<EmailAddress>`): it then wraps there,
 * and breaks anywhere only inside a piece wider than the line.
 */

import type { JSX, ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export interface CopyableValueProps {
  value: string
  className?: string
  /** After the value reached the clipboard (a surface that counts its copies). */
  onCopied?: () => void
  /**
   * How the value is shown, when it marks its own break opportunities (`<wbr>`);
   * `value` is still what is copied. Without it, the value breaks anywhere.
   */
  children?: ReactNode
}

export function CopyableValue({ value, className, onCopied, children }: CopyableValueProps): JSX.Element {
  const t = useTranslations(commonCopy)
  const [copied, raise] = useTransientFlag()

  const copy = (): void => {
    // Absent in a non-secure context, rejected when the document is not
    // focused. Neither is worth an error: the value is on screen in full and
    // can still be selected by hand.
    void navigator.clipboard?.writeText(value).then(() => {
      raise()
      onCopied?.()
    }, () => {})
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={t('copyableValue.copy', { value })}
        className={cn(
          // A copy press is a pressable like any other (`design-language.md`, „One press“): the kit's press and ring.
          'hover:bg-hover rounded-control -mx-1 inline-flex max-w-full items-start gap-1.5 px-1 text-right text-xs outline-none',
          PRESSABLE,
          FOCUS_RING,
          children === undefined ? 'break-all' : '[overflow-wrap:anywhere]',
          // The value stays a few pixels tall on a desktop; under a finger the
          // row grows to the floor rather than overhanging its neighbour.
          'pointer-coarse:min-h-11 pointer-coarse:items-center',
          className
        )}
      >
        <span>{children ?? value}</span>
        {copied ? (
          <Check className="pointer-coarse:mt-0 mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Copy
            className="text-muted-foreground pointer-coarse:mt-0 mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? t('copyableValue.copied') : ''}
      </span>
    </>
  )
}
