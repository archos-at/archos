'use client'

import type { JSX } from 'react'
import { useId, useRef } from 'react'
import { cn } from '@/lib/utils'
import { ViewerSurface } from './viewer-surface'

export interface ViewerSliderProps {
  label: string
  min: number
  max: number
  step?: number
  value: number
  display: string
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  action?: React.ReactNode
  disabled?: boolean
  className?: string
}

export function ViewerSlider({
  label,
  min,
  max,
  step = 0.05,
  value,
  display,
  onChange,
  onCommit,
  action,
  disabled = false,
  className,
}: ViewerSliderProps): JSX.Element {
  const id = useId()

  const committed = useRef(value)
  const commit = (): void => {
    if (!onCommit || committed.current === value) return
    committed.current = value
    onCommit(value)
  }

  return (
    <ViewerSurface
      className={cn(
        'pointer-events-auto flex max-w-full items-center gap-2 px-3 py-2 sm:gap-3',
        'animate-in fade-in-0 slide-in-from-bottom-1 duration-base ease-entrance motion-reduce:animate-none',
        className
      )}
    >
      {/*
        The label is the slider's accessible name, so it cannot simply be
        dropped on a narrow screen — it is hidden VISUALLY and still read. At
        390 px the pill has to hold a range, a number and a direction button,
        and a visible caption is the one part a reader can infer from the
        building changing under it.
      */}
      <label htmlFor={id} className="text-muted-foreground sr-only text-xs whitespace-nowrap sm:not-sr-only">
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="accent-foreground h-1 w-24 min-w-0 flex-1 cursor-pointer pointer-coarse:h-11 sm:w-56 sm:flex-none"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {/*
        `<output>` has an implicit `role="status"`, which would announce the
        value a second time on every step of a drag now that the range itself
        carries `aria-valuetext`.
      */}
      <output aria-live="off" htmlFor={id} className="w-16 text-right font-mono text-xs tabular-nums">
        {display}
      </output>
      {action}
    </ViewerSurface>
  )
}
