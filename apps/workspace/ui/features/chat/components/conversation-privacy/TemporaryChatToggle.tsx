'use client'

import { useEffect, type JSX } from 'react'
import { HatGlasses } from 'lucide-react'
import { toast } from 'sonner'
import { Toggle } from '@/components/ui/toggle'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { useThreadRole } from '@/shared/collaboration/thread-sharing'
import { onTemporaryRefused, setConversationTemporary, useTemporarySwitch } from '../../lib/temporary-conversation'

const TEMPORARY_LAYER =
  'absolute rounded-[calc(var(--radius-control)+var(--temporary-out))] transition-[clip-path,background-color,opacity] duration-base ease-entrance motion-reduce:transition-none ' +
  '[clip-path:inset(0_0_0_calc(100%-var(--temporary-box)-2*var(--temporary-out))_round_calc(var(--radius-control)+var(--temporary-out)))] ' +
  'group-data-[state=on]/temporary:[clip-path:inset(0_round_calc(var(--radius-control)+var(--temporary-out)))]'

const TEMPORARY_FOCUS = 'opacity-0 group-focus-visible/temporary:opacity-100'

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
      variant="inverted"
      pressed={pressed}
      onPressedChange={(next) => {
        if (!pending) onPressedChange(next)
      }}
      disabled={disabled}
      aria-label={label}
      title={pressed ? t('temporary.switchOffTitle') : t('temporary.switchOnTitle')}
      aria-busy={pending || undefined}
      data-testid="temporary-chat-toggle"
      className={cn(
        'group/temporary pointer-events-none relative isolate gap-0 px-0 [--temporary-box:2.125rem] pointer-coarse:[--temporary-box:2.75rem]',
        'bg-transparent! shadow-none! focus-visible:ring-0 focus-visible:ring-offset-0',
        className
      )}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10">
        <span className={cn(TEMPORARY_LAYER, TEMPORARY_FOCUS, '-inset-1 bg-ring/60 [--temporary-out:4px]')} />
        <span className={cn(TEMPORARY_LAYER, TEMPORARY_FOCUS, '-inset-0.5 bg-background [--temporary-out:2px]')} />
        <span
          data-testid="temporary-chat-pill"
          className={cn(
            TEMPORARY_LAYER,
            'pointer-events-auto inset-0 [--temporary-out:0px] group-hover/temporary:bg-hover group-data-[state=on]/temporary:bg-foreground'
          )}
        />
      </span>
      <span className="flex h-full items-center px-[calc((var(--temporary-box)-18px)/2)]">
        <span className="size-[18px] shrink-0" />
        <span
          aria-hidden="true"
          data-testid="temporary-chat-word"
          data-shown={pressed}
          className={cn(
            'ps-1.5 transition-opacity ease-out motion-reduce:transition-none max-sm:hidden',
            pressed ? 'opacity-100 delay-(--motion-snap) duration-quick' : 'opacity-0 duration-snap'
          )}
        >
          {t('temporary.label')}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 start-[calc((var(--temporary-box)-18px)/2)] flex w-[calc(100%-var(--temporary-box))] items-center',
          'transition-transform duration-base ease-entrance motion-reduce:transition-none',
          pressed ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <HatGlasses className="size-[18px]" data-testid="temporary-chat-glyph" />
      </span>
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

  const handleChange = (next: boolean): void => setConversationTemporary(conversationId, next)

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
