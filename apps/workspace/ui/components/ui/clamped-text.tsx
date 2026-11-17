'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

const CLAMP = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
  5: 'line-clamp-5',
  6: 'line-clamp-6',
} as const

export interface ClampedTextProps {
  children: string
  lines: keyof typeof CLAMP
  moreLabel: string
  lessLabel: string
  className?: string
  testId?: string
}

export function ClampedText({ children, lines, moreLabel, lessLabel, className, testId }: ClampedTextProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const element = textRef.current
    if (!element) return

    const measure = () => {
      if (expanded) return
      setIsTruncated(element.scrollHeight - element.clientHeight > 2)
    }
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, children])

  return (
    <>
      <p
        ref={textRef}
        data-testid={testId}
        className={cn(className, !expanded && CLAMP[lines])}
      >
        {children}
      </p>
      {(isTruncated || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="text-muted-foreground duration-snap hover:text-foreground focus-visible:ring-ring/50 touch-target mt-1.5 inline-flex items-center gap-1 text-xs font-medium transition-colors ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
        >
          {expanded ? lessLabel : moreLabel}
          <ChevronDown
            className={cn(
              'duration-quick size-3 shrink-0 transition-transform ease-out motion-reduce:transition-none',
              expanded && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
      )}
    </>
  )
}
