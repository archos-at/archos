'use client'

import type { JSX } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { fitName, type FittedName } from '@/lib/text/fit-name'
import { cn } from '@/lib/utils'

/**
 * A name in at most `lines` lines of the width it is given, by `fitName`'s one
 * rule: whole, broken only between words; else its middle cut, keeping the
 * extension and the end before it; else its end cut. Every file tile and row
 * draws its name with it, so a tile never breaks „Tragwerksplan/ung“ and a row
 * never shows „R…“ with its ellipsis lost.
 *
 * Measured on a canvas in the element's own font, at the width a shared
 * `ResizeObserver` reports, and again once the web font has loaded. Before
 * that (the server's HTML, a test without a canvas) the name is the whole text
 * clamped to its lines, broken only between words. The drawn lines are hidden
 * from assistive technology; the whole name is read once.
 */
export function FittedName({
  text,
  lines = 1,
  cut = 'middle',
  firstLineInset = 0,
  className,
}: {
  text: string
  lines?: number
  /** `end` for a name whose start tells it apart; `middle` (a file's) keeps its extension. */
  cut?: 'middle' | 'end'
  /** Pixels the first line gives up at its end, for a control that stands there (a tile's ⋯). */
  firstLineInset?: number
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [fitted, setFitted] = useState<FittedName | null>(null)
  const fit = useCallback(() => {
    const element = ref.current
    const measure = element ? measurerFor(element) : null
    if (!element || !measure) return
    const width = element.getBoundingClientRect().width
    if (width <= 0) return
    // Half a pixel short: a canvas measures to the subpixel, the layout rounds.
    const next = fitName(text, { width: width - 0.5, lines, measure, cut, firstLineInset })
    setFitted((current) => (current && sameLines(current, next) ? current : next))
  }, [text, lines, cut, firstLineInset])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    fit()
    const stop = observeWidth(element, fit)
    void document.fonts?.ready.then(fit)
    return stop
  }, [fit])

  return (
    <span
      ref={ref}
      className={cn('block min-w-0 max-w-full', className)}
      title={fitted?.cut ? text : undefined}
      data-fitted={fitted ? (fitted.cut ? 'cut' : 'whole') : undefined}
    >
      {fitted ? (
        <>
          <span className="sr-only">{text}</span>
          {fitted.lines.map((line, index) => (
            <span key={index} aria-hidden className="block overflow-hidden whitespace-pre">
              {line}
            </span>
          ))}
        </>
      ) : (
        <span className={cn('block break-normal [overflow-wrap:normal]', lines === 1 ? 'truncate' : 'line-clamp-2')} style={lines > 2 ? { WebkitLineClamp: lines } : undefined}>
          {text}
        </span>
      )}
    </span>
  )
}

const sameLines = (a: FittedName, b: FittedName): boolean => a.cut === b.cut && a.lines.join('\n') === b.lines.join('\n')

let canvas: CanvasRenderingContext2D | null | undefined
/** The font last set on the canvas: `ctx.font` reads back normalised, so comparing with it set the font on every call. */
let fontSet = ''
const widths = new Map<string, number>()

/** A measure in the element's font, or null where there is no canvas (jsdom). */
function measurerFor(element: HTMLElement): ((text: string) => number) | null {
  if (canvas === undefined) {
    try {
      canvas = document.createElement('canvas').getContext('2d')
    } catch {
      canvas = null
    }
  }
  const ctx = canvas
  if (!ctx) return null
  const style = getComputedStyle(element)
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return (value) => {
    const key = `${font}\u0000${value}`
    const known = widths.get(key)
    if (known !== undefined) return known
    if (fontSet !== font) {
      ctx.font = font
      fontSet = font
    }
    const width = ctx.measureText(value).width
    if (widths.size > 20_000) widths.clear()
    widths.set(key, width)
    return width
  }
}

let observer: ResizeObserver | null = null
const listeners = new Map<Element, () => void>()

/** One observer for every name on the page: a folder of a thousand rows is a thousand callbacks, not observers. */
function observeWidth(element: Element, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) listeners.get(entry.target)?.()
  })
  listeners.set(element, onResize)
  observer.observe(element)
  return () => {
    listeners.delete(element)
    observer?.unobserve(element)
  }
}
