'use client'

import type { JSX, ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function RegisterBar({ start, end }: { start: ReactNode; end: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2" data-testid="search-register-bar">
      <div className="flex min-w-0 items-center gap-2">{start}</div>
      <div className="flex items-center gap-2">{end}</div>
    </div>
  )
}

export function LabelledSwitch({
  id,
  label,
  checked,
  onCheckedChange,
  testId,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  testId?: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} data-testid={testId} />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal text-foreground">
        {label}
      </Label>
    </div>
  )
}
