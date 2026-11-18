'use client'

import { useLayoutEffect, useRef, useState, type ElementType } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'

const CLAMP: Record<1 | 2 | 3, string> = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
}

interface ClampedTextProps {
  children: string
  lines?: 1 | 2 | 3
  className?: string
  as?: ElementType
}

export function ClampedText({ children, lines = 2, className, as: Tag = 'p' }: ClampedTextProps) {
  const t = useTranslations(chatCopy)
  const ref = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children, lines, open])

  return (
    <>
      <Tag ref={ref} className={cn('break-words', !open && CLAMP[lines], className)}>
        {children}
      </Tag>
      {cut && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            'touch-target card-caption text-muted-foreground hover:text-foreground self-start rounded -ml-1 px-1 py-0.5 font-medium',
            'transition-colors duration-quick ease-out',
            'focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          {open ? t('cards.clamp.less') : t('cards.clamp.more')}
        </button>
      )}
    </>
  )
}
