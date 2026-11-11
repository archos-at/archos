import type { HTMLAttributes, JSX, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * FactLine — one fact about a thing, a glyph and its words, at caption size:
 * „Wird auf Schadsoftware geprüft …“, „Domain nicht bestätigt“, „Das Original
 * enthält Schadsoftware …“. Muted by default; `default` in ink; `warning` for
 * what must be seen before acting; `danger` for what makes the action
 * impossible. Colour never travels alone: the glyph and the words always come
 * with it.
 *
 * A signal colour is a glyph colour here, never a text colour
 * (`design-language.md`, „Warning gold is a glyph colour“): `text-warning`
 * measured 4.48:1 on paper at 12px and the signal red 4.08:1 on its tint
 * (axe, 2026-10-22 and 2026-10-27), both under the 4.5:1 WCAG AA asks of body
 * text. So `warning` and `danger` draw the glyph in the signal and the words in
 * ink, a step heavier.
 */
export type FactTone = 'muted' | 'default' | 'warning' | 'danger'

const FACT_TONE: Record<FactTone, string> = {
  muted: 'text-muted-foreground',
  default: 'text-foreground',
  warning: 'text-foreground font-medium [&>svg]:text-warning',
  danger: 'text-foreground font-medium [&>svg]:text-error',
}

export function FactLine({
  icon: Icon,
  tone = 'muted',
  children,
  className,
  testId,
  ...props
}: Omit<HTMLAttributes<HTMLParagraphElement>, 'children'> & {
  icon: LucideIcon
  tone?: FactTone
  children: ReactNode
  testId?: string
}): JSX.Element {
  return (
    <p
      className={cn(
        'flex min-w-0 items-start gap-1.5 text-xs leading-snug',
        FACT_TONE[tone],
        className
      )}
      data-slot="fact-line"
      data-testid={testId}
      data-tone={tone}
      {...props}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  )
}
