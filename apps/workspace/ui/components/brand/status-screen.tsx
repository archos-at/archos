import * as React from 'react'

import { Logo } from '@/components/brand/logo'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'

/**
 * Full-page status screen used by not-found / error / permission boundaries.
 * Calm, centered, branded: a real surface of the product instead of an unstyled crash.
 */
export interface StatusScreenProps {
  code?: string
  title: string
  description: string
  actions?: React.ReactNode
  /** A drawing (`StatusDrawing`) between the logo and the text; decorative. */
  art?: React.ReactNode
  /** A quiet line under the actions, such as the reference of an error to quote when reporting it. */
  detail?: React.ReactNode
  className?: string
}

export function StatusScreen({ code, title, description, actions, art, detail, className }: StatusScreenProps) {
  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center',
        className,
      )}
    >
      <Logo size="medium" className="mb-8" />
      {art && <div className="mb-8 flex w-full justify-center">{art}</div>}
      {code && <SectionLabel as="p">{code}</SectionLabel>}
      <h1 className="mt-2 text-xl font-medium text-foreground text-balance">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground text-balance">{description}</p>
      {actions && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
      {detail && <p className="mt-6 font-mono text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}
