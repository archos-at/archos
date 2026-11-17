'use client'

import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { useIsPresent, type Transition } from 'motion/react'
import { CircleCheck, CircleMinus, type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  AnimatePresence,
  motion,
  motionQuick,
  motionQuickExit,
  useMotionToken,
} from '@/components/motion'
import { useHeightGlide } from '@/components/motion/height-glide'
import { cn } from '@/lib/utils'
import { CARD_SHELL } from './card-chrome'

type ProposalTone = 'pending' | 'accepted' | 'dismissed'

const OUTCOME_GLYPH: Record<ProposalTone, LucideIcon | null> = {
  pending: null,
  accepted: CircleCheck,
  dismissed: CircleMinus,
}

const OUTCOME_INK: Record<ProposalTone, string> = {
  pending: '',
  accepted: 'text-success',
  dismissed: 'text-muted-foreground',
}

const TONE_GAP: Record<ProposalTone, string> = {
  pending: 'gap-3',
  accepted: 'gap-2',
  dismissed: 'gap-2',
}

function ProposalBody({
  ref,
  tone,
  enter,
  exit,
  children,
}: {
  ref: Ref<HTMLDivElement>
  tone: ProposalTone
  enter: Transition
  exit: Transition
  children: ReactNode
}) {
  const present = useIsPresent()
  const Glyph = OUTCOME_GLYPH[tone]
  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      data-proposal-body={tone}
      aria-hidden={present ? undefined : true}
      className={cn('flex flex-col outline-none', TONE_GAP[tone], !present && 'pointer-events-none')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: enter }}
      exit={{ opacity: 0, transition: exit }}
    >
      {Glyph ? (
        <div className="flex items-start gap-2">
          <Glyph data-outcome={tone} className={cn('mt-0.5 size-4 shrink-0', OUTCOME_INK[tone])} aria-hidden />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </motion.div>
  )
}

export function ProposalShell({
  tone,
  className,
  children,
}: {
  tone: ProposalTone
  className?: string
  children: ReactNode
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const previousTone = useRef(tone)
  const enter = useMotionToken(motionQuick)
  const exit = useMotionToken(motionQuickExit)
  useHeightGlide(frameRef, tone)

  useLayoutEffect(() => {
    if (previousTone.current === tone) return
    previousTone.current = tone
    const active = document.activeElement
    if (active && active !== document.body && frameRef.current?.contains(active)) {
      bodyRef.current?.focus({ preventScroll: true })
    }
  }, [tone])

  return (
    <Card
      className={cn(CARD_SHELL, 'p-5', className)}
    >
      {/* The frame the height glides on. `relative` is for `popLayout`,
          which positions the outgoing body absolutely against it. */}
      <div ref={frameRef} className="relative">
        <AnimatePresence mode="popLayout" initial={false}>
          <ProposalBody key={tone} ref={bodyRef} tone={tone} enter={enter} exit={exit}>
            {children}
          </ProposalBody>
        </AnimatePresence>
      </div>
    </Card>
  )
}
