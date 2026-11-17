import { type FC, memo } from 'react'
import { FileText } from 'lucide-react'
import { AgentPrompt, AgentResponse, ErrorBanner, UserMessage } from '@/features/chat'
import type { ChatMessage } from '@/features/chat/types'
import type { UserMessageAuthor } from '@/features/chat/components/UserMessage'
import type { Finding, Findings } from '@/lib/conversations/message-findings'
import { RunBlockMessage } from '@/features/runs/components/RunBlockMessage'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'
import { SourceDeletedNote } from '@/components/projects/source-deleted-note'

interface MessageRendererProps {
  message: ChatMessage
  conversationId?: string | null
  projectId?: string | null
  onErrorDismiss?: (messageId: string) => void
  onErrorRetry?: (messageId: string) => void
  showReasoning?: boolean
  author?: UserMessageAuthor
  grouped?: boolean
  currentUserId?: string | null
  promptAddresseeName?: string | null
  previousFindings?: Findings
  onCommissionFinding?: (finding: Finding) => Promise<boolean>
  onContinueRun?: (message: ChatMessage) => Promise<void>
}

const MessageRendererComponent: FC<MessageRendererProps> = ({
  message,
  conversationId,
  projectId,
  onErrorDismiss,
  onErrorRetry,
  showReasoning = false,
  author,
  grouped,
  currentUserId,
  promptAddresseeName,
  previousFindings,
  onCommissionFinding,
  onContinueRun,
}) => {
  const tFileStatus = useTranslations(researchCopy)
  const tCommon = useTranslations(commonCopy)
  const messageType = message.messageType || (message.role === 'user' ? 'user' : 'assistant')

  switch (messageType) {
    case 'user':
      return (
        <UserMessage
          content={message.content}
          timestamp={message.timestamp}
          author={author}
          grouped={grouped}
          mentions={message.mentions}
          currentUserId={currentUserId}
        />
      )

    case 'prompt':
      return (
        <AgentPrompt
          content={message.content}
          options={message.promptOptions}
          isResponded={message.isPromptResponded}
          response={message.promptResponse}
          timestamp={message.timestamp}
          isAddressee={!message.promptFor || message.promptFor === currentUserId}
          addresseeName={promptAddresseeName}
        />
      )

    case 'agent_response': {
      const answer = (
        <>
          <AgentResponse
            content={message.erasedAt ? tCommon('derivedSource.erased') : message.content}
            timestamp={message.timestamp}
            answerDurationMs={message.answerDurationMs}
            cards={message.cards}
            citations={message.citations}
            conversationId={conversationId}
            cardInteractions={message.cardInteractions}
            stages={message.stages}
            answerMeta={message.answerMeta}
            findings={message.findings}
            previousFindings={previousFindings}
            onCommissionFinding={onCommissionFinding}
            answerConfidence={message.answerConfidence}
            answerConfidenceCappedReason={message.answerConfidenceCappedReason}
            answerConfidenceReason={message.answerConfidenceReason}
            confidenceCheck={message.confidenceCheck}
            answerConfidenceVersion={message.answerConfidenceVersion}
            lookupFoundNothing={message.lookupFoundNothing}
            citationsRemoved={message.citationsRemoved}
            readSources={message.readSources}
            researchTruncated={message.researchTruncated}
            truncationReason={message.truncationReason}
            degradedReasons={message.degradedReasons}
            skillsActivated={message.skillsActivated}
            skillsHidden={message.skillsHidden}
            showReasoning={showReasoning}
            messageId={message.id}
            isStreaming={message.isStreaming}
            stopped={message.stopped === true}
            failed={message.failed === true}
            routingDecision={message.routingDecision}
            retrievalLedger={message.retrievalLedger}
            quoteStamps={message.quoteStamps}
          />
          {message.sourceDeletedAt && !message.erasedAt && (
            <SourceDeletedNote at={message.sourceDeletedAt} className="mt-1 px-1" />
          )}
        </>
      )
      if (message.runLedger) {
        return (
          <RunBlockMessage
            message={message}
            projectId={projectId}
            conversationId={conversationId}
            answer={answer}
            onContinue={onContinueRun ? () => onContinueRun(message) : null}
          />
        )
      }
      return answer
    }

    case 'file':
      if (!message.fileData) {
        return null
      }
      const fileStatus = message.fileData.fileStatus
      const fileStatusLabel =
        fileStatus === 'uploading'
          ? tFileStatus('fileSourceCard.statusUploading')
          : fileStatus === 'ingesting'
            ? tFileStatus('fileSourceCard.statusIngesting')
            : fileStatus === 'success'
              ? tFileStatus('fileSourceCard.statusAvailable')
              : fileStatus === 'error'
                ? tFileStatus('fileSourceCard.statusError')
                : tFileStatus('fileSourceCard.statusAvailable')
      return (
        <div
          className="bg-muted flex items-center gap-2 rounded-bubble px-4 py-2  shadow-xs"
          role="status"
        >
          <FileText className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="text-muted-foreground text-sm">
            {message.fileData.fileName} ({fileStatusLabel})
          </span>
        </div>
      )

    case 'error':
      if (!message.errorData) {
        return null
      }
      return (
        <ErrorBanner
          code={message.errorData.errorCode}
          message={message.errorData.errorMessage}
          details={message.errorData.errorDetails}
          timestamp={message.timestamp}
          onDismiss={onErrorDismiss ? () => onErrorDismiss(message.id) : undefined}
          onRetry={onErrorRetry ? () => onErrorRetry(message.id) : undefined}
        />
      )

    case 'assistant':
      return null

    default:
      return null
  }
}

const areMessageRendererPropsEqual = (
  prev: MessageRendererProps,
  next: MessageRendererProps
): boolean =>
  prev.message === next.message &&
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.isStreaming === next.message.isStreaming &&
  prev.conversationId === next.conversationId &&
  prev.projectId === next.projectId &&
  prev.previousFindings === next.previousFindings &&
  prev.onCommissionFinding === next.onCommissionFinding &&
  prev.onContinueRun === next.onContinueRun &&
  prev.showReasoning === next.showReasoning &&
  prev.grouped === next.grouped &&
  prev.currentUserId === next.currentUserId &&
  Boolean(prev.author) === Boolean(next.author) &&
  prev.author?.userId === next.author?.userId &&
  prev.author?.name === next.author?.name &&
  prev.author?.avatarUrl === next.author?.avatarUrl &&
  prev.author?.isYou === next.author?.isYou &&
  prev.onErrorDismiss === next.onErrorDismiss &&
  prev.onErrorRetry === next.onErrorRetry

export const MessageRenderer = memo(MessageRendererComponent, areMessageRendererPropsEqual)
MessageRenderer.displayName = 'MessageRenderer'
