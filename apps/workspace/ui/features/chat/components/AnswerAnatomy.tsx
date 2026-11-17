'use client'

import { type FC, type ReactNode } from 'react'
import type { AnatomyShape, AnatomyVerdict } from '../lib/answer-meta-cards'
import { CalloutCard } from '@/features/cards/components/CalloutCard'
import { KeyTakeawaysCard } from '@/features/cards/components/KeyTakeawaysCard'
import { VerdictHeaderCard } from '@/features/cards/components/VerdictHeaderCard'
import { WorkReportCard } from '@/features/cards/components/WorkReportCard'
import type { AnswerKind } from '@/lib/conversations/message-answer-meta'

function showsVerdictMasthead(
  kind: AnswerKind | undefined,
  verdict: AnatomyVerdict | undefined
): boolean {
  return (
    Boolean(verdict) &&
    verdict?.type === 'verdict_header' &&
    (kind === 'ruling' || kind === undefined)
  )
}

export const AnatomyMasthead: FC<{
  verdict?: AnatomyVerdict
  summary?: string
  topic?: string
  context?: string
  kind?: AnswerKind
  caret?: ReactNode
}> = ({ verdict, summary, topic, context, kind, caret }) => {
  if (!mastheadShows({ verdict, summary, topic, kind })) return null
  const showVerdict = showsVerdictMasthead(kind, verdict)
  const showTopic = !showVerdict && Boolean(topic)
  return (
    <header className="border-border/70 flex flex-col gap-3 border-b pb-4">
      {showVerdict && verdict && verdict.type === 'verdict_header' && (
        <VerdictHeaderCard
          flat
          verdict={verdict.verdict}
          subject={verdict.subject}
          reference={verdict.reference}
          confidence={verdict.confidence}
          confidence_reason={verdict.confidence_reason}
        />
      )}
      {showTopic && topic && <p className="card-headline text-foreground text-balance">{topic}</p>}
      {context && (showVerdict || showTopic || summary) && (
        <p className="text-muted-foreground text-sm leading-relaxed">{context}</p>
      )}
      {summary && (
        <p className="text-foreground text-answer">
          {summary}
          {caret}
        </p>
      )}
    </header>
  )
}

export function mastheadShows({
  verdict,
  summary,
  topic,
  kind,
}: {
  verdict?: AnatomyVerdict
  summary?: string
  topic?: string
  kind?: AnswerKind
}): boolean {
  return showsVerdictMasthead(kind, verdict) || Boolean(topic) || Boolean(summary)
}

export const AnatomyBlock: FC<{ card: AnatomyShape }> = ({ card }) => {
  if (card.type === 'callout') {
    return (
      <CalloutCard flat kind={card.kind} text={card.text} title={card.title} detail={card.detail} />
    )
  }
  if (card.type === 'key_takeaways') {
    return <KeyTakeawaysCard flat title={card.title} items={card.items ?? []} />
  }
  if (card.type === 'work_report') {
    return <WorkReportCard done={card.done} proposed={card.proposed} blocked={card.blocked} next={card.next} />
  }
  return null
}
