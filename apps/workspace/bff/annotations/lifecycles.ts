import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import type { AgentWakeStatus, AnnotationStatus } from './types'

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
