'use client'

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { identityInk } from '@/components/ui/avatar-identity'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { CURSOR_CHAT_MAX } from '@/lib/annotations/room-types'
import { cn } from '@/lib/utils'
import { restoreFocus } from './focus-return'

export const CURSOR_CHAT_LINGER_MS = 4_000

let lingering: ReturnType<typeof setTimeout> | null = null

const EDGE = 8

export function placeChat(
  pointer: { x: number; y: number } | null,
  bounds: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  foot: number
): { left: number; top: number } {
  const wanted = pointer
    ? { left: pointer.x + 14, top: pointer.y + 16 }
    : { left: bounds.left + (bounds.width - size.width) / 2, top: bounds.top + bounds.height - foot - size.height }
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))
  return {
    left: clamp(wanted.left, bounds.left + EDGE, bounds.left + bounds.width - size.width - EDGE),
    top: clamp(wanted.top, bounds.top + EDGE, bounds.top + bounds.height - size.height - EDGE),
  }
}

export function CursorChat({
  userId,
  from,
  bounds,
  foot = 72,
  onChat,
  onClose,
}: {
  from: { x: number; y: number } | null
  bounds?: () => DOMRect | null
  foot?: number
  userId: string | null
  onChat: (text: string | null) => void
  onClose: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [text, setText] = useState('')
  const [at, setAt] = useState<{ x: number; y: number } | null>(from)
  const done = useRef(false)
  const field = useRef<HTMLInputElement | null>(null)
  const bubble = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 240, height: 64 })
  useLayoutEffect(() => {
    const node = bubble.current
    if (node && node.offsetWidth > 0) setSize({ width: node.offsetWidth, height: node.offsetHeight })
  }, [])
  const onChatRef = useRef(onChat)
  useEffect(() => {
    onChatRef.current = onChat
  })
  const before = useRef<Element | null>(null)
  useEffect(() => {
    before.current = document.activeElement
    if (lingering) clearTimeout(lingering)
    lingering = null
    field.current?.focus({ preventScroll: true })
  }, [])

  const follows = from !== null
  useEffect(() => {
    if (!follows) return
    let frame = 0
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setAt({ x: event.clientX, y: event.clientY }))
    }
    window.addEventListener('pointermove', move)
    return () => {
      window.removeEventListener('pointermove', move)
      cancelAnimationFrame(frame)
    }
  }, [follows])

  useEffect(
    () => () => {
      if (!done.current) onChatRef.current(null)
      const trigger = before.current
      requestAnimationFrame(() => restoreFocus(trigger))
    },
    []
  )

  const ink = identityInk(userId ?? 'me')
  const frame =
    bounds?.() ??
    (typeof window === 'undefined' ? null : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight })
  const place = frame ? placeChat(at, frame, size, foot) : { left: 0, top: 0 }
  const finish = (keep: boolean) => {
    if (done.current) return
    done.current = true
    if (keep && text.trim()) {
      const say = onChatRef.current
      lingering = setTimeout(() => {
        lingering = null
        say(null)
      }, CURSOR_CHAT_LINGER_MS)
    }
    else onChat(null)
    onClose()
  }

  return (
    <div
      ref={bubble}
      data-testid="cursor-chat"
      className={cn(
        'pointer-events-auto fixed z-50 w-60 px-3 py-2 text-background shadow-lg',
        at ? 'rounded-surface rounded-tl-sm' : 'rounded-surface'
      )}
      style={{ backgroundColor: ink, left: place.left, top: place.top }}
    >
      <input
        ref={field}
        aria-label={t('review.chatOpen')}
        data-testid="cursor-chat-input"
        maxLength={CURSOR_CHAT_MAX}
        value={text}
        placeholder={t('review.chatPlaceholder')}
        className="w-full rounded-control border-0 bg-transparent px-1 text-sm leading-5 font-medium text-background placeholder:font-normal placeholder:text-background pointer-coarse:text-base shadow-none"
        style={{ outlineColor: 'color-mix(in oklch, var(--background) 75%, transparent)', outlineOffset: 1 }}
        onChange={(event) => {
          setText(event.target.value)
          onChat(event.target.value || null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          }
        }}
        onBlur={() => finish(true)}
      />
      <p className="mt-0.5 text-[10px] leading-3 text-background">{t('review.chatHint')}</p>
    </div>
  )
}
