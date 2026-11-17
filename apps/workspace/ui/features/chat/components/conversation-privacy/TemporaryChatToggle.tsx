'use client'

import { useEffect, type JSX } from 'react'
import { MessageCircleDashed } from 'lucide-react'
import { toast } from 'sonner'
import { Toggle } from '@/components/ui/toggle'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { useThreadRole } from '@/shared/collaboration/thread-sharing'
import { useChatStore } from '../../store'
import { onTemporaryRefused, setConversationTemporary, useTemporarySwitch } from '../../lib/temporary-conversation'

export interface TemporaryChatToggleViewProps {
  pressed: boolean
  pending?: boolean
  disabled?: boolean
  onPressedChange: (pressed: boolean) => void
  className?: string
}

export function TemporaryChatToggleView({
  pressed,
  pending = false,
  disabled = false,
  onPressedChange,
  className,
}: TemporaryChatToggleViewProps): JSX.Element {
  const t = useTranslations(chatCopy)
  const label = pressed ? t('temporary.switchOff') : t('temporary.switchOn')
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled || pending}
      aria-label={label}
      title={pressed ? t('temporary.switchOffTitle') : t('temporary.switchOnTitle')}
      aria-busy={pending || undefined}
      data-testid="temporary-chat-toggle"
      className={cn('gap-1 px-2.5 text-xs max-sm:px-1.5', className)}
    >
      {/* The word at every width: a glyph alone is not found, and a pressed
          glyph does not say what is on. On a phone the composer row is 294px
          for five controls, so there the glyph goes and the word stays (the
          effort dial beside it gives up its chevron the same way). */}
      <MessageCircleDashed className="size-3.5 max-sm:hidden" aria-hidden="true" data-testid="temporary-chat-glyph" />
      <span data-testid="temporary-chat-word">{t('temporary.label')}</span>
    </Toggle>
  )
}

export interface TemporaryChatToggleProps {
  conversationId: string | null | undefined
  disabled?: boolean
  className?: string
}

export function TemporaryChatToggle({
  conversationId,
  disabled = false,
  className,
}: TemporaryChatToggleProps): JSX.Element | null {
  const t = useTranslations(chatCopy)
  const view = useTemporarySwitch(conversationId)
  const role = useThreadRole(conversationId)

  useEffect(
    () =>
      onTemporaryRefused((error) => {
        const status = (error as { status?: unknown } | null)?.status
        toast.error(status === 403 || status === 404 ? t('temporary.ownerOnly') : t('temporary.switchFailed'))
      }),
    [t]
  )

  if (role !== null && role !== 'owner') return null

  const handleChange = (next: boolean): void => {
    const id = conversationId ?? useChatStore.getState().ensureSession()
    if (id) setConversationTemporary(id, next)
  }

  return (
    <TemporaryChatToggleView
      pressed={view.pressed}
      pending={view.pending}
      disabled={disabled}
      onPressedChange={handleChange}
      className={className}
    />
  )
}
