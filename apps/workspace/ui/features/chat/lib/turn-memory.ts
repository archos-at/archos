/**
 * What Piloti recorded DURING ONE TURN — the input to the „Piloti hat sich
 * gemerkt" chip (`docs/architecture/post-answer-stages.md` §1.1, §1.7, §5.1).
 *
 * Every note a turn saves reaches the reader here, on one of three shelves
 * (ADR-0180: mine, the project's, the office's), and the chip labels WHEN each
 * was written apart:
 *
 * 1. **In-turn.** The `remember` tool, called by the model while it answers.
 *    A write it made on its own is listed on the reflection stage's frame
 *    (`provenance: 'agent'`). When the write needs the user's own authority it
 *    arrives as a `memory_proposal` card, and it is a memory only once they say
 *    yes — which is why the decision, not the card, is what admits it here.
 * 2. **After the answer.** The `memory_reflection` stage, whose frame lands on
 *    `message.stages.memoryReflection` (`provenance_type = 'distillation'` on
 *    the row it wrote).
 *
 * The project's and the office's notes are read off the MESSAGE, which is the
 * whole point. Until this existed
 * the chip was fed by `useConversationMemory`, a three-shot HTTP poll on a
 * `[0, 1500, 4000]` ms schedule — a guess about how long an LLM takes, made by
 * the half of the system that cannot know, and mounted once per rendered
 * answer, so a ten-answer thread fired thirty GETs for one conversation's
 * memory. Worse, what came back was scoped to the CONVERSATION, so after turn
 * five, turn one's answer also read „Piloti hat sich 5 gemerkt". A memory row
 * has never had a turn identity (§1.6); the stage frame gives it one, and this
 * module is where a turn's memory finally means the turn's.
 *
 * A pure module with its own fast spec, not logic inside the render function —
 * `ui/features/chat/lib/` is where this codebase puts the part that can be
 * tested in a millisecond instead of a mount (AGENTS.md).
 *
 * **A PERSONAL note is never on the message** (ADR-0180): other people read a
 * shared conversation's messages. The agent stores it with the id of the
 * answer it was saved under (`personal_memory.source_message_id`, the id this
 * message carries), and the owner's browser asks for its own notes of the
 * conversation (`stores/turn-notes-store.ts`). Row-level security answers
 * nobody else, so {@link TurnMemoryInput.personalNotes} is empty for every
 * other reader.
 *
 * **What is still NOT here:** a shared note saved in a turn whose stage frame
 * never came (the `memory-reflection` flag off for the office, no model
 * configured for the stage, or no socket open when it finished), and a note
 * the BFF only refreshed because it was already held.
 */

import type { AnswerCard } from '@/shared/cards/schemas'
import { cardKey, type CardInteractions } from '@/features/cards/card-decision'
import type { DecidedProposals } from '@/features/cards/decided-proposals'
import type { MessageStages } from '@/lib/conversations/message-stages'

/**
 * Where a remembered item came from. Not the raw `provenance_type` of the row:
 * the reader is being told WHEN it happened relative to the answer they are
 * looking at, which is the only distinction the chip draws.
 */
export type TurnMemoryProvenance =
  /** The post-answer reflection stage — „nach der Antwort ergänzt". */
  | 'distillation'
  /** The `remember` tool, mid-answer — „während der Antwort notiert". */
  | 'inTurn'

/** One thing Piloti recorded during this turn, as the chip renders it. */
export interface TurnMemoryItem {
  /** Stable within the turn: a row id, or the card key that produced it. */
  id: string
  /** `decision` | `constraint` | `open_question` | `derived_fact` | `preference`. */
  kind: string
  /** The finding itself, shown verbatim. */
  content: string
  provenance: TurnMemoryProvenance
  /**
   * The earlier note this one corrected, quoted verbatim, when the write
   * REPLACED something rather than adding to it: a card's
   * `memory_proposal.supersedes` (accepting the card retires that note), or a
   * frame item's `supersedes`, which the agent sets only when the BFF retired
   * the earlier note. A correction is the event a reader most needs to see,
   * because something they may have relied on is gone, and it is the one note
   * the chip does not take back: removing it would not bring the old one back.
   */
  supersedes?: string
  /**
   * Who reads the note: only the reader, the project's members, the members
   * cleared for a restricted folder, or everyone in the office (ADR-0180 rule
   * 1, a note's home says who reads it). Absent when the write did not record
   * where it went (a proposal decided before `results.scope` existed): the
   * chip then says nothing rather than guess.
   */
  audience?: TurnMemoryAudience
  /**
   * The id of the stored note, which is what taking it back deletes. Absent
   * when the turn does not know it (a card the browser decided before the
   * proposal recorded what it created): such a row offers no remove action.
   */
  noteId?: string
}

/**
 * Who reads a note, by where it was put. `restricted` is project memory that
 * draws on a restricted folder (ADR-0087): only members cleared for it.
 */
export type TurnMemoryAudience = 'personal' | 'project' | 'restricted' | 'organization'

/** One of the reader's own personal notes saved under this answer, as `GET /api/user/memory` lists it. */
export interface PersonalTurnNote {
  id: string
  kind: string
  content: string
  /** `distillation`: the reflection stage kept it after the answer; anything else, the tool during it. */
  provenanceType: string
}

/**
 * The card decisions that mean a memory was actually WRITTEN.
 *
 * A `memory_proposal` card is a question, and its own tool result says so in as
 * many words: "It has NOT been saved yet — do not claim it was saved; the user
 * decides." Counting an undecided or dismissed one as something Piloti
 * remembered would make the chip lie in the direction that matters most, since
 * its entire job is to tell a reader what is now durable about their project.
 */
const SAVED: ReadonlySet<string> = new Set(['savedOrg', 'savedProject'])

/**
 * Whether the reader's decision on this card wrote the note. A card with a
 * `proposal_id` is decided on the server and only the proposal says how it
 * ended (`applied`; a dismissed, failed or still open one wrote nothing, and a
 * proposal not seen yet is not claimed). A card without one is an older answer
 * the browser decided, and its decision is on the message.
 */
function wasRemembered(
  card: Extract<AnswerCard, { type: 'memory_proposal' }>,
  key: string,
  cardInteractions: CardInteractions | undefined,
  decidedProposals: DecidedProposals | undefined
): boolean {
  if (card.proposal_id) return decidedProposals?.[card.proposal_id]?.status === 'applied'
  return SAVED.has(cardInteractions?.[key]?.decision ?? '')
}

/**
 * Where the reader's decision put the note, which is not always where the card
 * asked for („Nur im Projekt merken“): the proposal's own result says it, and
 * for an older card the decision's name does.
 */
function rememberedFor(
  card: Extract<AnswerCard, { type: 'memory_proposal' }>,
  key: string,
  cardInteractions: CardInteractions | undefined,
  decidedProposals: DecidedProposals | undefined
): TurnMemoryAudience | undefined {
  if (card.proposal_id) {
    return decidedProposals?.[card.proposal_id]?.results?.find((result) => result.scope)?.scope
  }
  return cardInteractions?.[key]?.decision === 'savedOrg' ? 'organization' : 'project'
}

/** The note an accepted proposal created, when its result names one. */
const createdNoteId = (
  card: Extract<AnswerCard, { type: 'memory_proposal' }>,
  decidedProposals: DecidedProposals | undefined
): string | undefined =>
  card.proposal_id ? decidedProposals?.[card.proposal_id]?.results?.find((result) => result.ok && result.itemId)?.itemId : undefined

interface TurnMemoryInput {
  /** Post-answer stage output on this message. */
  stages?: MessageStages
  /** The cards this answer carried, in the order they were emitted. */
  cards?: (AnswerCard | undefined)[]
  /** The reader's answer to each interactive card, keyed by `cardKey`. */
  cardInteractions?: CardInteractions
  /**
   * The proposed changes seen decided (ADR-0105). A memory card with a
   * `proposal_id` is answered on the server and writes no `cardInteractions`,
   * so its decision is read from here instead.
   */
  decidedProposals?: DecidedProposals
  /**
   * The reader's OWN personal notes saved under this answer. Never read from
   * the message; empty for everyone but the note's owner.
   */
  personalNotes?: readonly PersonalTurnNote[]
}

/**
 * Everything this turn recorded, in-turn writes first.
 *
 * Order is deliberate and chronological: the `remember` tool ran while the
 * answer was being written, the reflection stage ran after it was finished. The
 * chip's popover is a list of what happened, so it reads in the order it
 * happened.
 */
export function turnMemoryItems({
  stages,
  cards,
  cardInteractions,
  decidedProposals,
  personalNotes,
}: TurnMemoryInput): TurnMemoryItem[] {
  const items: TurnMemoryItem[] = []

  for (const [index, card] of (cards ?? []).entries()) {
    // A hole is a card validation rejected (`validateAnswerCards` keeps wire
    // positions): nothing to attribute a memory write to.
    if (!card || card.type !== 'memory_proposal') continue
    const key = cardKey(card, index)
    if (!wasRemembered(card, key, cardInteractions, decidedProposals)) continue
    const supersedes = card.supersedes?.trim()
    const audience = rememberedFor(card, key, cardInteractions, decidedProposals)
    const noteId = createdNoteId(card, decidedProposals)
    items.push({
      id: key,
      kind: card.kind,
      content: card.content,
      provenance: 'inTurn',
      ...(supersedes ? { supersedes } : {}),
      ...(audience ? { audience } : {}),
      ...(noteId ? { noteId } : {}),
    })
  }

  // The stage's frame lists what the turn wrote to SHARED memory: the tool's
  // notes (`provenance: 'agent'`) and the reflection pass's own.
  for (const item of stages?.memoryReflection?.items ?? []) {
    items.push({
      id: item.id,
      noteId: item.id,
      kind: item.kind,
      content: item.content,
      provenance: item.provenance === 'agent' ? 'inTurn' : 'distillation',
      audience: item.scope === 'organization' ? 'organization' : item.restricted ? 'restricted' : 'project',
      ...(item.supersedes ? { supersedes: item.supersedes } : {}),
    })
  }

  for (const note of personalNotes ?? []) {
    items.push({
      id: note.id,
      noteId: note.id,
      kind: note.kind,
      content: note.content,
      provenance: note.provenanceType === 'distillation' ? 'distillation' : 'inTurn',
      audience: 'personal',
    })
  }

  // Stable: what was written during the answer stays ahead of what followed it.
  return [...items.filter((item) => item.provenance === 'inTurn'), ...items.filter((item) => item.provenance !== 'inTurn')]
}
