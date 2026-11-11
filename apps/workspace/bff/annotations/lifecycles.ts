/**
 * The legal moves of a mark and of a wake on one (ADR-0178), beside the
 * vocabulary they are made of (`./types`). No `server-only`: the browser may
 * read them as it reads the tuples.
 */
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import type { AgentWakeStatus, AnnotationStatus } from './types'

/**
 * A mark's lifecycle (ADR-0178). A person's mark is born `open`; the agent's is a
 * proposal until a person takes it over (`accept`) or discards it. Reopening a
 * closed mark is the only way back. What each move stamps (who accepted, who
 * closed) is `transition` in `./service`.
 */
export const ANNOTATION_LIFECYCLE = defineLifecycle<AnnotationStatus, 'accept' | 'dismiss' | 'resolve' | 'reopen'>({
  id: 'annotation',
  initial: 'proposed',
  bornAs: ['open'],
  states: {
    proposed: { on: { accept: 'open', dismiss: 'dismissed' } },
    open: { on: { resolve: 'resolved' } },
    resolved: { on: { reopen: 'open' } },
    dismissed: { on: { reopen: 'open' } },
  },
})

/**
 * A wake's lifecycle (ADR-0178). The job settles a queued wake: it started a
 * turn, or it did not and says why. A turn's end is also accepted from
 * `queued`, because a turn that errors at once can report before the job has
 * marked the wake started. Every end is final: the first final word stands.
 */
export const AGENT_WAKE_LIFECYCLE = defineLifecycle<
  AgentWakeStatus,
  'start' | 'answer' | 'stop' | 'suppress' | 'refuse' | 'fail'
>({
  id: 'agent-wake',
  initial: 'queued',
  bornAs: ['suppressed'],
  states: {
    queued: {
      on: { start: 'started', answer: 'answered', stop: 'stopped', suppress: 'suppressed', refuse: 'refused', fail: 'failed' },
    },
    started: { on: { answer: 'answered', stop: 'stopped', fail: 'failed' } },
    answered: { type: 'final' },
    stopped: { type: 'final' },
    suppressed: { type: 'final' },
    refused: { type: 'final' },
    failed: { type: 'final' },
  },
})
