'use client'

import type { JSX, KeyboardEvent, PointerEvent, RefObject } from 'react'
import { ChevronsLeftRight } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { percentAlong, swipeKeyTarget } from './lib/swipe'

export interface SwipeDividerProps {
  value: number
  onChange: (value: number) => void
  trackRef: RefObject<HTMLElement | null>
}

export function SwipeDivider({ value, onChange, trackRef }: SwipeDividerProps): JSX.Element {
  const t = useTranslations(filesCopy)

  const move = (event: PointerEvent<HTMLElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect) onChange(percentAlong(event.clientX, rect))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const next = swipeKeyTarget(value, event.key, event.shiftKey)
    if (next === null) return
    event.preventDefault()
    onChange(next)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t('compare.swipeDivider')}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={t('compare.swipeValue', { percent: Math.round(value) })}
      title={t('compare.swipeHint')}
      data-testid="swipe-divider"
      className="group absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none outline-none pointer-coarse:w-11"
      style={{ left: `${value}%` }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        move(event)
      }}
      onPointerMove={move}
      onDoubleClick={() => onChange(50)}
      onKeyDown={onKeyDown}
    >
      <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-[var(--compare-paper-ink)] shadow-[0_0_0_1px_var(--compare-paper)]" />
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--compare-paper-ink)] text-[var(--compare-paper)] shadow-[0_0_0_2px_var(--compare-paper),0_2px_6px_rgb(0_0_0/0.3)] group-focus-visible:shadow-[0_0_0_2px_var(--compare-paper),0_0_0_4px_var(--compare-paper-ink)]"
      >
        <ChevronsLeftRight className="size-4" />
      </span>
    </div>
  )
}
