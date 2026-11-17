'use client'

import { type FC, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { useLayoutStore } from '@/features/layout/store'
import { TechnicalSteps } from './TechnicalSteps'
import { LookStepRows } from './LookStepRow'
import {
  placedLookIds,
  withActionRounds,
  workRounds,
  type LinkSelection,
} from '../../lib/work-list'
import { deriveTraceLanes } from '../../lib/trace-lanes'
import { buildCitationModel } from '../../lib/citations'
import { retrievalRounds } from '../../lib/retrieval-rounds'
import { FALLBACK_W, measuredFanWidth, planFan } from './flow/flow-layout'
import { defaultFoldedRounds, SpineFolding, GraphInteraction } from './flow/round-kind'
import { buildGraph } from './flow/build-graph'
import { FlowInner } from './flow/flow-inner'
import { ReasoningFlowProps } from './flow/reasoning-flow-props'

export const ReasoningFlow: FC<ReasoningFlowProps> = (props) => {
  const {
    steps,
    userQuestion,
    answerConfidence,
    citations,
    escalationReason,
    retrievalLedger,
    live,
    sourceCards,
  } = props
  const t = useTranslations(chatCopy)
  const showTechnicalReasoning = useLayoutStore((s) => s.showTechnicalReasoning)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setWidth((previous) => measuredFanWidth(previous, el.clientWidth))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cards = useMemo(
    () => sourceCards ?? buildCitationModel({ traceLanes: deriveTraceLanes(steps), citations }),
    [sourceCards, steps, citations]
  )
  const layout = useMemo(() => planFan(width || FALLBACK_W, cards.length), [width, cards.length])

  const [foldOverrides, setFoldOverrides] = useState<ReadonlyMap<number, boolean>>(new Map())
  const rounds = useMemo(() => withActionRounds(retrievalRounds(steps), steps), [steps])
  const roundCount = rounds.length
  const unplacedSteps = useMemo(() => {
    const placed = placedLookIds(workRounds(steps))
    return placed.size === 0
      ? steps
      : steps.filter((step) => !(step.kind === 'look' && placed.has(step.id)))
  }, [steps])
  const roundCountRef = useRef(roundCount)
  useEffect(() => {
    roundCountRef.current = roundCount
  }, [roundCount])
  const toggleFold = useCallback(
    (index: number) =>
      setFoldOverrides((prev) => {
        const next = new Map(prev)
        next.set(index, !(prev.get(index) ?? defaultFoldedRounds(roundCountRef.current).has(index)))
        return next
      }),
    []
  )
  const folding = useMemo<SpineFolding>(() => {
    const byDefault = defaultFoldedRounds(roundCount)
    const folded = new Set<number>()
    for (let i = 0; i < roundCount; i++) {
      if (foldOverrides.get(i) ?? byDefault.has(i)) folded.add(i)
    }
    return { folded, onToggle: toggleFold }
  }, [foldOverrides, roundCount, toggleFold])

  const [selection, setSelection] = useState<LinkSelection | null>(null)
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(new Set())
  const toggleOpenFold = useCallback(
    (key: string) =>
      setOpenFolds((prev) => {
        const next = new Set(prev)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    []
  )
  const interaction = useMemo<GraphInteraction>(
    () => ({ selection, onSelect: setSelection, openFolds, onToggleFold: toggleOpenFold }),
    [selection, openFolds, toggleOpenFold]
  )

  const built = useMemo(
    () =>
      buildGraph(
        {
          steps,
          userQuestion,
          answerConfidence,
          citations,
          escalationReason,
          ...(retrievalLedger ? { retrievalLedger } : {}),
          live,
        },
        t,
        layout,
        cards,
        folding,
        rounds,
        interaction
      ),
    [
      steps,
      userQuestion,
      answerConfidence,
      citations,
      escalationReason,
      retrievalLedger,
      live,
      t,
      layout,
      cards,
      folding,
      rounds,
      interaction,
    ]
  )

  return (
    <div ref={containerRef} className="flex w-full flex-col gap-3">
      <ReactFlowProvider>
        <FlowInner built={built} layout={layout} live={live ?? false} />
      </ReactFlowProvider>

      {/* Looks the graph's round nodes do not draw (ADR-0128): all of them in a turn
          from before the action step, none in one that has it. */}
      <LookStepRows steps={unplacedSteps} />

      {showTechnicalReasoning && steps.length > 0 && (
        <div className="border-base border-t pt-2">
          <TechnicalSteps steps={steps} t={t} />
        </div>
      )}
    </div>
  )
}
