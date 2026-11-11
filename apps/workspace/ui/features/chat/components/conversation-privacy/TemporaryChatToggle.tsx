'use client'

/**
 * The switch for a temporary chat (ADR-0180 rule 2), in the composer beside
 * the effort dial: the other setting that belongs to one conversation, and the
 * one place that exists both before a chat has started and after. The thread
 * header's menu, where Share lives, appears only with the first message, which
 * is too late to start a chat that keeps nothing.
 *
 * Only the conversation's owner may switch it (`setConversationTemporary` on
 * the server), so a collaborator or a viewer gets no control: the line under
 * the composer (`ConversationPrivacyLine`) still tells them what holds.
 */

import { useState, type JSX } from 'react'
import { MessageCircleDashed } from 'lucide-react'
import { toast } from 'sonner'
import { Toggle } from '@/components/ui/toggle'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { useThreadRole } from '@/shared/collaboration/thread-sharing'
import { useChatStore } from '../../store'
import { setConversationTemporary, useConversationTemporary } from '../../lib/temporary-conversation'

export interface TemporaryChatToggleViewProps {
  pressed: boolean
  /** A switch is on its way to the server. */
  pending?: boolean
  disabled?: boolean
  onPressedChange: (pressed: boolean) => void
  className?: string
}

/** The control alone, for the composer and for the preview. */
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
  /** The open conversation; none yet on the start screen, where the switch mints one. */
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
  const temporary = useConversationTemporary(conversationId)
  // Published by the shared-thread seam. Null in a private thread, where the
  // reader is its only member and so its owner.
  const role = useThreadRole(conversationId)
  const [pending, setPending] = useState(false)

  if (role !== null && role !== 'owner') return null

  const handleChange = async (next: boolean): Promise<void> => {
    // The start screen has no conversation until the first keystroke: mint it
    // now, so the choice has something to be kept on.
    const id = conversationId ?? useChatStore.getState().ensureSession()
    if (!id) return
    setPending(true)
    try {
      await setConversationTemporary(id, next)
    } catch (error) {
      const status = (error as { status?: unknown } | null)?.status
      toast.error(status === 403 || status === 404 ? t('temporary.ownerOnly') : t('temporary.switchFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <TemporaryChatToggleView
      pressed={temporary}
      pending={pending}
      disabled={disabled}
      onPressedChange={(next) => void handleChange(next)}
      className={className}
    />
  )
}
