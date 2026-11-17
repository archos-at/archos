'use client'

import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react'

export interface ColumnSelection {
  selected: number
  plotRef: RefObject<HTMLDivElement | null>
  plotProps: {
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  }
  columnProps: (index: number) => {
    type: 'button'
    tabIndex: 0 | -1
    'aria-pressed': boolean
    'data-selected': boolean
    onClick: () => void
    onFocus: () => void
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => void
  }
}

export function useColumnSelection(count: number): ColumnSelection {
  const [picked, setPicked] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const selected = picked !== null && picked < count ? picked : Math.max(count - 1, 0)

  const columnAt = useCallback(
    (clientX: number): number | null => {
      const rect = plotRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || count === 0) return null
      const ratio = (clientX - rect.left) / rect.width
      return Math.min(count - 1, Math.max(0, Math.floor(ratio * count)))
    },
    [count]
  )

  const scrub = (event: PointerEvent<HTMLDivElement>): void => {
    const index = columnAt(event.clientX)
    if (index !== null) setPicked(index)
  }

  const plotProps: ColumnSelection['plotProps'] = {
    onPointerDown: (event) => {
      if (event.pointerType !== 'mouse') scrub(event)
    },
    onPointerMove: (event) => {
      if (event.pointerType !== 'mouse' && event.buttons > 0) scrub(event)
    },
    onKeyDown: (event) => {
      const next = (() => {
        switch (event.key) {
          case 'ArrowLeft':
            return Math.max(selected - 1, 0)
          case 'ArrowRight':
            return Math.min(selected + 1, count - 1)
          case 'Home':
            return 0
          case 'End':
            return count - 1
          default:
            return null
        }
      })()
      if (next === null) return
      event.preventDefault()
      setPicked(next)
      plotRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
    },
  }

  const columnProps: ColumnSelection['columnProps'] = (index) => ({
    type: 'button',
    tabIndex: index === selected ? 0 : -1,
    'aria-pressed': index === selected,
    'data-selected': index === selected,
    onClick: () => setPicked(index),
    onFocus: () => setPicked(index),
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') setPicked(index)
    },
  })

  return { selected, plotRef, plotProps, columnProps }
}
