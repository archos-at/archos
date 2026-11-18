'use client'

import { AnswerTurn } from './turn-previews'
import { SeedMemoryDecision, SeedRetryAction } from './seed-chat-store'
import { fireCitations, stairCitations, variantsCitations } from './source-fixtures'
import {
  anatomyAnswer,
  anatomyMeta,
  anatomyQuestion,
  feedbackAnswer,
  feedbackQuestion,
  followUpsAnswer,
  followUpsQuestion,
  followUpsStageItems,
  ledeCardAnswer,
  ledeCardQuestion,
  ledeCards,
  memoryAnswer,
  memoryCorrectionCards,
  memoryCorrectionDecisions,
  memoryCorrectionStage,
  memoryQuestion,
  memoryStage,
  streamingPartial,
  streamingQuestion,
  streamingSettled,
  structuredAnswer,
  structuredQuestion,
  twoCards,
  twoCardsAnswer,
  twoCardsQuestion,
  variantsAnswer,
  variantsCards,
  variantsQuestion,
} from './answer-fixtures'

const ANSWER_VARIANTS = [
  'feedback-open',
  'lede-card',
  'two-cards',
  'follow-ups-rail',
  'memory-chip',
  'anatomy',
  'structured',
  'variants',
  'streaming',
] as const
type AnswerVariant = (typeof ANSWER_VARIANTS)[number]

export const isAnswerVariant = (value: string | null): value is AnswerVariant =>
  ANSWER_VARIANTS.includes(value as AnswerVariant)

export function AnswerLayer({ variant }: { variant: AnswerVariant }) {
  if (variant === 'feedback-open') {
    return (
      <>
        <SeedRetryAction />
        <AnswerTurn
          label="↓ AT REST — the footnote is one 24px line: copy, export, the question, two thumbs"
          question={feedbackQuestion}
          answer={feedbackAnswer}
          citations={stairCitations}
          confidenceReason="Laufbreite direkt aus OIB-RL 4 und § 111 BO Wien belegt"
          messageId="msg-feedback-rest"
          conversationId="conv-feedback-rest"
        />
        <AnswerTurn
          label="↓ NOT HELPFUL, REASON CHOSEN — 'Gründlicher neu beantworten' sits beside the thumbs; the disclosure takes the next line, the row above it does not move"
          question={feedbackQuestion}
          answer={feedbackAnswer}
          citations={stairCitations}
          confidenceReason="Laufbreite direkt aus OIB-RL 4 und § 111 BO Wien belegt"
          messageId="msg-feedback-down"
          conversationId="conv-feedback-down"
        />
      </>
    )
  }

  if (variant === 'anatomy') {
    return (
      <AnswerTurn
        label="↓ NATIVE ANATOMY — verdict masthead above the prose, callout anchored by [[callout]], takeaways closing"
        question={anatomyQuestion}
        answer={anatomyAnswer}
        citations={stairCitations}
        confidenceReason="Absturzhöhe am Modell gemessen, Grenzwert direkt aus OIB-RL 4 belegt"
        messageId="msg-anatomy"
        answerMeta={anatomyMeta}
      />
    )
  }

  if (variant === 'structured') {
    return (
      <AnswerTurn
        label="↓ MARKDOWN FIRST — tables with a Fundstelle column, status words as chips, a drawing where the answer forks, a task list; no card"
        question={structuredQuestion}
        answer={structuredAnswer}
        citations={fireCitations}
        confidenceReason="Anforderungen direkt aus OIB-RL 2 Tabelle 1b belegt"
        messageId="msg-structured"
      />
    )
  }

  if (variant === 'lede-card') {
    return (
      <AnswerTurn
        label="↓ LEDE + INLINE CARD — first paragraph typeset as the lede, calculation spliced in by [[card:1]]"
        question={ledeCardQuestion}
        answer={ledeCardAnswer}
        cards={ledeCards}
        citations={stairCitations}
        confidenceReason="Schrittmaßregel direkt aus OIB-RL 4 belegt"
        messageId="msg-lede-card"
      />
    )
  }

  if (variant === 'streaming') {
    return (
      <>
        <AnswerTurn
          label="↓ STREAMING — the prose as the final call writes it; each [N] a pending pill until its source is settled"
          question={streamingQuestion}
          answer={streamingPartial}
          citations={[]}
          confidenceReason="—"
          messageId="msg-streaming-partial"
          isStreaming
        />
        <AnswerTurn
          label="↓ SETTLED MID-STREAM — the text closed, its citations verified: real pills, still arriving, no cards yet"
          question={streamingQuestion}
          answer={streamingSettled}
          citations={fireCitations.slice(0, 1)}
          confidenceReason="Anforderungen direkt aus OIB-RL 2 Tabelle 1b belegt"
          messageId="msg-streaming-settled"
          isStreaming
        />
        <AnswerTurn
          label="↓ FINAL — the terminal frame: the same numbers, the answer complete"
          question={streamingQuestion}
          answer={streamingSettled}
          citations={fireCitations.slice(0, 1)}
          confidenceReason="Anforderungen direkt aus OIB-RL 2 Tabelle 1b belegt"
          messageId="msg-streaming-final"
        />
      </>
    )
  }

  if (variant === 'variants') {
    return (
      <AnswerTurn
        label="↓ VARIANTS (live answer) — shared prose, then Tabs holding one Text table per variant"
        question={variantsQuestion}
        answer={variantsAnswer}
        cards={variantsCards}
        citations={variantsCitations}
        confidenceReason="OIB-Mai-2023-Anforderungen belegt; Bundesland und Nutzung sind nicht angegeben"
        messageId="msg-variants"
      />
    )
  }

  if (variant === 'two-cards') {
    return (
      <AnswerTurn
        label="↓ TWO CARDS — building_section placed inline, calculation unplaced → fallback block above the footer"
        question={twoCardsQuestion}
        answer={twoCardsAnswer}
        cards={twoCards}
        citations={fireCitations}
        confidenceReason="Tabelle 1b der OIB-RL 2 direkt als Quelle belegt"
        messageId="msg-two-cards"
      />
    )
  }

  if (variant === 'follow-ups-rail') {
    return (
      <>
        <AnswerTurn
          label="↓ AS THE ANSWER LANDS — the stage has not answered yet, and nothing is held open for it"
          question={followUpsQuestion}
          answer={followUpsAnswer}
          citations={stairCitations}
          confidenceReason="Definition und Messregel direkt aus OIB-RL 4 belegt"
          messageId="msg-follow-ups-before"
        />
        <AnswerTurn
          label="↓ TWO SECONDS LATER — the rail appended BELOW the answer card, outside it, in the same column"
          question={followUpsQuestion}
          answer={followUpsAnswer}
          citations={stairCitations}
          confidenceReason="Definition und Messregel direkt aus OIB-RL 4 belegt"
          messageId="msg-follow-ups-after"
          rail={followUpsStageItems}
        />
      </>
    )
  }

  return (
    <>
      <SeedMemoryDecision />
      <AnswerTurn
        label="↓ NOTHING WAS RECORDED — the stage ran and declined, which is its most common correct outcome"
        question={memoryQuestion}
        answer={memoryAnswer}
        citations={stairCitations}
        confidenceReason="Definition des Aufenthaltsraums direkt aus OIB-RL 4 belegt"
        messageId="msg-memory-empty"
      />
      <AnswerTurn
        label="↓ TWO WERE — the chip sits on the meta row beside „Details“, not inside it; one tap names each item and where it came from"
        question={memoryQuestion}
        answer={memoryAnswer}
        citations={stairCitations}
        confidenceReason="Definition des Aufenthaltsraums direkt aus OIB-RL 4 belegt"
        messageId="msg-memory-noted"
        stages={memoryStage}
      />
      <AnswerTurn
        label="↓ ONE NOTE CORRECTED — „Gedächtnis aktualisiert“ with its own glyph; the popover lists the correction first, the retired note struck through"
        question={memoryQuestion}
        answer={memoryAnswer}
        cards={memoryCorrectionCards}
        cardInteractions={memoryCorrectionDecisions}
        citations={stairCitations}
        confidenceReason="Definition des Aufenthaltsraums direkt aus OIB-RL 4 belegt"
        messageId="msg-memory-corrected"
        stages={memoryCorrectionStage}
      />
    </>
  )
}
