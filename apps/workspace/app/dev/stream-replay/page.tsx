'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AgentResponse } from '@/features/chat/components/AgentResponse'
import { parseWireEvent, type WireEvent } from '@/adapters/api/wire-v2'
import { foldTurnEvent, initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { citationsFromWireList } from '@/features/chat/lib/wire-citation'
import { sanitizeAnswerMeta } from '@/lib/conversations/message-answer-meta'
import { validateAnswerCards } from '@/shared/cards/schemas'
import { STREAM_FRAMES } from '../_fixtures/stream-frames'
import { answerBodies, asSettled, stampFrame } from '../_fixtures/v2-turn'

interface Shift {
  t: number
  phase: string
  value: number
  sources: { node: string; dy: number; dh: number; edge: boolean }[]
}

interface ReplayProbe {
  phase: string
  done: boolean
  shifts: Shift[]
  anchorTops: { t: number; phase: string; top: number }[]
}

declare global {
  interface Window {
    __replay?: ReplayProbe
  }
}

interface View {
  turn: TurnView
  phase: 'waiting' | 'prose' | 'settled' | 'cards' | 'final'
}

const IDS = { conversationId: 'replay', turnId: 'replay', messageId: 'replay' }
const EMPTY: View = { turn: initialTurnView(IDS.turnId, IDS.conversationId), phase: 'waiting' }

const replayEvents = (
  name: 'varianten' | 'oib2',
  speed: number,
  recordedEnding: boolean
): { at: number; event: WireEvent }[] => {
  const bodies = answerBodies(STREAM_FRAMES[name], IDS.messageId, 0, speed)
  return (recordedEnding ? bodies : asSettled(bodies)).flatMap(({ at, body }, index) => {
    const event = parseWireEvent(stampFrame(index + 1, body, IDS))
    return event ? [{ at, event }] : []
  })
}

const applyEvent = (view: View, event: WireEvent): View => {
  const turn = foldTurnEvent(view.turn, event)
  if (event.type === 'RUN_FINISHED') return { turn, phase: 'final' }
  if (event.type === 'STATE_SNAPSHOT') return { turn, phase: 'settled' }
  if (event.type === 'CUSTOM' && event.name === 'card') return { turn, phase: 'cards' }
  return { turn, phase: view.phase === 'waiting' ? 'prose' : view.phase }
}

const describe = (node: Node | null | undefined): string => {
  if (!node || !(node instanceof Element)) return String(node?.nodeName ?? 'text')
  const cls =
    typeof node.className === 'string' ? node.className.split(' ').slice(0, 3).join('.') : ''
  return `${node.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
}

export default function StreamReplayPage() {
  const params = useSearchParams()
  const name = (params.get('fixture') === 'oib2' ? 'oib2' : 'varianten') as 'varianten' | 'oib2'
  const speed = Number(params.get('speed') ?? '1') || 1
  const recordedEnding = params.get('ending') === 'recorded'
  const events = useMemo(() => replayEvents(name, speed, recordedEnding), [name, speed, recordedEnding])
  const [view, setView] = useState<View>(EMPTY)

  const probe = useMemo<ReplayProbe>(
    () => ({ phase: 'waiting', done: false, shifts: [], anchorTops: [] }),
    []
  )
  const startRef = useRef(0)

  useEffect(() => {
    window.__replay = probe
    const start = performance.now()
    startRef.current = start
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number
        sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[]
      })[]) {
        probe.shifts.push({
          t: Math.round(entry.startTime - start),
          phase: probe.phase,
          value: Number(entry.value.toFixed(4)),
          sources: (entry.sources ?? []).map((s) => ({
            node: describe(s.node),
            dy: Math.round(s.currentRect.top - s.previousRect.top),
            dh: Math.round(s.currentRect.height - s.previousRect.height),
            edge: s.previousRect.height === 0 || s.currentRect.height === 0,
          })),
        })
      }
    })
    observer.observe({ type: 'layout-shift', buffered: false })

    const timers: number[] = []
    const later = (run: () => void, ms: number) => timers.push(window.setTimeout(run, ms))
    events.forEach(({ at, event }, index) =>
      later(() => {
        setView((current) => applyEvent(current, event))
        if (index === events.length - 1) later(() => (probe.done = true), 1500)
      }, at + 500)
    )
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      observer.disconnect()
    }
  }, [probe, events])

  useEffect(() => {
    probe.phase = view.phase
    const first = document.querySelector('[data-replay-answer] .markdown-content > :first-child')
    if (first) {
      probe.anchorTops.push({
        t: Math.round(performance.now() - startRef.current),
        phase: view.phase,
        top: Math.round(first.getBoundingClientRect().top + window.scrollY),
      })
    }
  }, [probe, view])

  return (
    <main className="bg-background min-h-screen p-6">
      <div className="text-muted-foreground mb-4 font-mono text-xs">
        /dev/stream-replay?fixture={name} · phase: {view.phase} · {events.length} events
      </div>
      <div data-replay-answer className="mx-auto w-full max-w-[760px]">
        {view.phase !== 'waiting' && (
          <AgentResponse
            content={view.turn.text}
            timestamp={new Date('2026-09-24T14:30:12')}
            isStreaming={view.turn.phase === 'running'}
            cards={Array.from(view.turn.cards, (card) => (card ? validateAnswerCards([card.card])[0] : undefined))}
            citations={citationsFromWireList(view.turn.sources)}
            answerConfidence={view.turn.result?.answer_confidence ?? undefined}
            answerMeta={sanitizeAnswerMeta(view.turn.answerMeta) ?? undefined}
            routingDecision="shallow"
            messageId={`replay-${name}`}
          />
        )}
      </div>
    </main>
  )
}
