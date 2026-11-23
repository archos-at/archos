'use client'

import { type JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TextQuote } from 'lucide-react'
import { FloatingToolbar, ToolbarTextButton } from '@/components/ui/floating-toolbar'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useCoarsePointer } from '../hooks/use-coarse-pointer'
import { selectedExcerpt, type SelectedExcerpt } from '../lib/answer-excerpt'
import { useChatStore } from '../store'

const GAP = 8
const BUTTON_HEIGHT = 28
const COARSE_BUTTON_HEIGHT = 44
const EDGE = 12

const placeOf = (rect: DOMRect, coarse: boolean): { top: number; left: number } => {
  const height = coarse ? COARSE_BUTTON_HEIGHT : BUTTON_HEIGHT
  const above = rect.top - GAP - height
  const below = rect.bottom + GAP
  const top = coarse || above < EDGE ? Math.min(below, window.innerHeight - height - EDGE) : above
  const left = Math.min(Math.max(rect.left + rect.width / 2, EDGE), window.innerWidth - EDGE)
  return { top, left }
}

export function AnswerExcerptAsk({ conversationId }: { conversationId: string | null | undefined }): JSX.Element | null {
  const t = useTranslations(chatCopy)
  const coarse = useCoarsePointer()
  const setComposerExcerpt = useChatStore((state) => state.setComposerExcerpt)
  const [selected, setSelected] = useState<SelectedExcerpt | null>(null)
  const buttonRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    let frame = 0
    const read = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setSelected(selectedExcerpt(document.getSelection())))
    }
    const onSelectionChange = () => {
      if (!draggingRef.current) read()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (buttonRef.current?.contains(event.target as Node | null)) return
      draggingRef.current = true
      setSelected(null)
    }
    const onPointerUp = () => {
      draggingRef.current = false
      read()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('scroll', onSelectionChange, true)
    window.addEventListener('resize', onSelectionChange)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('scroll', onSelectionChange, true)
      window.removeEventListener('resize', onSelectionChange)
    }
  }, [])

  if (!selected || !conversationId) return null

  const ask = () => {
    setComposerExcerpt({ conversationId, messageId: selected.messageId, text: selected.text })
    document.getSelection()?.removeAllRanges()
    setSelected(null)
  }

  return createPortal(
    <div
      ref={buttonRef}
      className="fixed z-50 -translate-x-1/2"
      style={placeOf(selected.rect, coarse)}
      data-testid="answer-excerpt-ask"
    >
      <FloatingToolbar>
        <ToolbarTextButton
          data-attr="chat-answer-excerpt-ask"
          className="text-foreground gap-1.5 px-2"
          onPointerDown={(event) => event.preventDefault()}
          onClick={ask}
        >
          <TextQuote className="size-3.5" aria-hidden="true" />
          {t('answerExcerpt.ask')}
        </ToolbarTextButton>
      </FloatingToolbar>
    </div>,
    document.body
  )
}
