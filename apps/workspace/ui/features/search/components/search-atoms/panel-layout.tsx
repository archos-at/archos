'use client'

import type { FormEvent, JSX, ReactNode } from 'react'

export function DialogForm({ children, onSubmit }: { children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void }): JSX.Element {
  return (
    <form className="flex min-w-0 flex-col gap-5" onSubmit={onSubmit} noValidate>
      {children}
    </form>
  )
}

export function PanelBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex min-w-0 flex-col gap-3">{children}</div>
}

export function QuietLine({ children, testId }: { children: ReactNode; testId?: string }): JSX.Element {
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  )
}
