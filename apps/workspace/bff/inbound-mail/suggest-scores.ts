import 'server-only'

import type { InboundMailPartRow, InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { recordMailThreadMatchScore, type ThreadChoice } from '@/lib/langfuse/mail-thread-match-score'
import { senderEvidenceOf } from './candidates'
import type { InboundMailDecisionVia } from './inbound-mail-vocabulary'
import type { InboundMailDecision } from './inbound-mail-wire'
import { decidedSuggestions, suggestionFollowed, type SuggestionFollowed } from './suggest'

export interface MailDecisionToScore {
  organizationId: string
  decidedBy: string
  mail: InboundMailRow
  parts: readonly InboundMailPartRow[]
  decision: Pick<InboundMailDecision, 'parts' | 'message'> | null
  via: InboundMailDecisionVia
  folderPathOf: (folderId: string) => string | null
  decidedAt?: Date
}

export function scoreMailDecision(input: MailDecisionToScore): SuggestionFollowed {
  const decided = decidedSuggestions(input.parts, input.decision, input.folderPathOf)
  for (const entry of decided) {
    if (!entry.traceId) continue
    void recordDecisionScore({
      organizationId: input.organizationId,
      subject: 'inbound_mail_suggestion',
      subjectId: entry.partId,
      decision: entry.outcome.decision,
      decidedBy: input.decidedBy,
      traceId: entry.traceId,
      detail: { folder: entry.outcome.folder, type: entry.outcome.type },
    })
  }
  const choice = threadChoiceOf(input.decision)
  const text = input.parts.find((part) => part.kind === 'message')
  if (choice && text && text.state === 'waiting') {
    void recordMailThreadMatchScore({
      organizationId: input.organizationId,
      projectId: input.mail.projectId,
      mailId: input.mail.id,
      partId: text.id,
      matches: input.mail.threadMatch,
      sender: senderEvidenceOf(input.mail),
      choice,
      via: input.via,
      decidedAt: input.decidedAt ?? new Date(),
    })
  }
  return suggestionFollowed(decided.map((entry) => entry.outcome))
}

function threadChoiceOf(decision: MailDecisionToScore['decision']): ThreadChoice | null {
  const thread = decision?.message?.thread
  if (!thread) return null
  return thread.action === 'append' ? { action: 'append', mailThreadId: thread.mailThreadId } : { action: 'create' }
}
