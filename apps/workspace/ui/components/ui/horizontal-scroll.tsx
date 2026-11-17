'use client'

import { type HTMLAttributes, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

const FADE_PX = 28

interface Overflow {
  start: boolean
  end: boolean
}

const maskFor = ({ start, end }: Overflow): string | undefined => {
  if (!start && !end) return undefined
  const from = start ? `transparent, black ${FADE_PX}px` : 'black, black'
  const to = end ? `black calc(100% - ${FADE_PX}px), transparent` : 'black, black'
  return `linear-gradient(to right, ${from}, ${to})`
}

const CUE_CLASS =
  'pointer-events-none absolute top-1/2 size-6 -translate-y-1/2 rounded-full bg-background/90 p-1 text-muted-foreground backdrop-blur-sm'

export interface HorizontalScrollProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  'aria-label': string
  cue?: boolean
}

export function HorizontalScroll({
  children,
  className,
  style,
  'aria-label': label,
  cue = false,
  ...props
}: HorizontalScrollProps) {
  const ref = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<Overflow>({ start: false, end: false })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const start = element.scrollLeft > 1
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      setOverflow((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end }
      )
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    if (typeof ResizeObserver === 'undefined')
      return () => element.removeEventListener('scroll', update)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    if (content.current) observer.observe(content.current)
    return () => {
      element.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  const mask = maskFor(overflow)
  const scrollable = overflow.start || overflow.end
  const scroller = (
    <div
      ref={ref}
      role={scrollable ? 'region' : undefined}
      tabIndex={scrollable ? 0 : undefined}
      aria-label={scrollable ? label : undefined}
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      className={cn('overflow-x-auto', className)}
      style={mask ? { ...style, maskImage: mask, WebkitMaskImage: mask } : style}
      {...props}
    >
      {/* As wide as its content, and never narrower than the scroller: a
          wide table or drawing overflows through it, and a `w-full` child
          still fills the column. */}
      <div ref={content} className="w-fit min-w-full">
        {children}
      </div>
    </div>
  )
  if (!cue) return scroller
  return (
    <div className="relative">
      {scroller}
      {overflow.start && (
        <ChevronLeft
          aria-hidden
          className={CUE_CLASS + ' left-1'}
        />
      )}
      {overflow.end && (
        <ChevronRight
          aria-hidden
          className={CUE_CLASS + ' right-1'}
        />
      )}
    </div>
  )
}
