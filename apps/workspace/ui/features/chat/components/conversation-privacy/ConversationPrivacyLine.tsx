'use client'

import type { JSX } from 'react'
import { Lock, MessageCircleDashed } from 'lucide-react'
import { FactLine } from '@/components/ui/fact-line'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { cn } from '@/lib/utils'
import { THREAD_COLUMN_INNER, THREAD_GUTTER } from '@/components/ui/thread-column'
import { useThreadSharing } from '@/shared/collaboration/thread-sharing'
import { useTemporarySwitch } from '../../lib/temporary-conversation'
import type { TemporarySwitchView } from '../../lib/temporary-switch-machine'

export type TemporaryStatement = TemporarySwitchView['statement']

export interface ConversationPrivacyLineViewProps {
  temporary: boolean | TemporaryStatement
  privateToReader: boolean
  reserved?: boolean
  className?: string
}

const STATEMENTS = ['temporary', 'turningOn', 'turningOff'] as const

const LAYER = 'col-start-1 row-start-1 transition-opacity duration-quick ease-out motion-reduce:transition-none'

export function ConversationPrivacyLineView({
  temporary,
  privateToReader,
  reserved = false,
  className,
}: ConversationPrivacyLineViewProps): JSX.Element | null {
  const t = useTranslations(chatCopy)
  const statement = temporary === true ? 'temporary' : temporary || null
  if (!statement && !privateToReader && !reserved) return null
  const sentence = (of: (typeof STATEMENTS)[number]): string =>
    t(of === 'temporary' ? 'temporary.statement' : `temporary.${of}`)
  const shown = reserved ? STATEMENTS : statement ? [statement] : []
  return (
    <div
      className={cn(THREAD_GUTTER, !statement && !reserved && 'sm:hidden', className)}
      data-testid="conversation-privacy-line"
    >
      <div className={cn(THREAD_COLUMN_INNER, 'grid justify-items-center pt-2')}>
        {shown.map((of) => (
          <div key={of} aria-hidden="true" className={cn(LAYER, of === statement ? 'opacity-100' : 'opacity-0')}>
            <FactLine
              icon={MessageCircleDashed}
              tone="default"
              testId={of === statement ? 'conversation-temporary-line' : undefined}
            >
              {sentence(of)}
            </FactLine>
          </div>
        ))}
        <p role="status" className="sr-only">
          {statement ? sentence(statement) : ''}
        </p>
        {privateToReader && (
          <div
            className={cn(LAYER, 'sm:hidden', statement ? 'opacity-0' : 'opacity-100')}
            aria-hidden={statement ? true : undefined}
            data-slot="phone-only"
          >
            <FactLine icon={Lock} testId="conversation-private-line">
              {t('privacy.onlyYou')}
            </FactLine>
          </div>
        )}
      </div>
    </div>
  )
}

export interface ConversationPrivacyLineProps {
  conversationId: string | null | undefined
  canCollaborate: boolean
  statesTemporary?: boolean
  className?: string
}

export function ConversationPrivacyLine({
  conversationId,
  canCollaborate,
  statesTemporary = true,
  className,
}: ConversationPrivacyLineProps): JSX.Element | null {
  const statement = useTemporarySwitch(conversationId).statement
  const temporary = statesTemporary ? statement : null
  const sharing = useThreadSharing(canCollaborate ? conversationId : null)
  return (
    <ConversationPrivacyLineView
      temporary={temporary}
      reserved
      privateToReader={sharing === 'private'}
      className={className}
    />
  )
}
