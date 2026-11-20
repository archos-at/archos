import type { ReactNode } from 'react'
import { AtSign, Eye } from 'lucide-react'
import type { Translator } from '@/i18n/translate'

interface ComposerHintInput {
  canCollaborate: boolean
  isViewerInSharedThread: boolean
  cannotChatInProject: boolean
  otherPersonsTurnName: string | null
  taggedHumans: readonly { display: string }[]
  agentTagged: boolean
  threadAwaitsHuman: boolean
  activeMentionCount: number
  tCollab: Translator
  tChat: Translator
}

export function renderComposerHint({
  canCollaborate,
  isViewerInSharedThread,
  cannotChatInProject,
  otherPersonsTurnName,
  taggedHumans,
  agentTagged,
  threadAwaitsHuman,
  activeMentionCount,
  tCollab,
  tChat,
}: ComposerHintInput): ReactNode {
  let composerHint: ReactNode = null
  if (canCollaborate && isViewerInSharedThread) {
    composerHint = (
      <p
        data-testid="composer-viewer-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <Eye className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>{tCollab('thread.viewerNotice')}</span>
      </p>
    )
  } else if (cannotChatInProject) {
    composerHint = (
      <p
        data-testid="composer-project-chat-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <Eye className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>{tChat('composer.noProjectChatPermission')}</span>
      </p>
    )
  } else if (canCollaborate && otherPersonsTurnName) {
    composerHint = (
      <p
        data-testid="composer-busy-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <span>{tCollab('thread.composerBusy', { name: otherPersonsTurnName })}</span>
      </p>
    )
  } else if (taggedHumans.length > 0 && !agentTagged) {
    composerHint = (
      <p
        data-testid="composer-mention-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <AtSign className="mt-0.5 size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>
          {/* German inflects the verb, so joining names into the singular
              string produced "Anna Berger, Tobias Kern WIRD gefragt" — wrong
              grammar in the primary product language. This i18n layer has no
              plural rules, hence two keys. */}
          {taggedHumans.length === 1
            ? tCollab('mentions.composerHint', { name: taggedHumans[0]!.display })
            : tCollab('mentions.composerHintMany', {
                names: taggedHumans.map((mention) => mention.display).join(', '),
              })}
        </span>
      </p>
    )
  } else if (canCollaborate && threadAwaitsHuman && activeMentionCount === 0) {
    composerHint = (
      <p
        data-testid="composer-agent-hint"
        className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs leading-relaxed"
        role="note"
      >
        <span>{tCollab('mentions.addressee.agentHint')}</span>
      </p>
    )
  }
  return composerHint
}
