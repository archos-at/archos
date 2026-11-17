'use client'

import { Toggle } from '@/components/ui/toggle'

export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Toggle
      pressed={active}
      aria-pressed={active}
      onPressedChange={() => onClick()}
      variant="inverted"
      size="default"
      className="shrink-0"
    >
      {label}
    </Toggle>
  )
}
