'use client'

import type { JSX } from 'react'
import { ToolbarTextButton } from '@/components/ui/floating-toolbar'

// Stand-in until the scale popover lands: the same export and props, showing the page's scale as a label.
export function ScaleControl({ calibration, page }: { calibration: { labelFor: (page: number) => string }; page: number }): JSX.Element | null {
  const label = calibration.labelFor(page)
  if (!label) return null
  return (
    <ToolbarTextButton disabled data-testid="measure-scale" className="disabled:opacity-100">
      {label}
    </ToolbarTextButton>
  )
}
