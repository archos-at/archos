'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { motionDeliberateEntrance, motionInstant, motionQuickExit, useMotionToken } from '@/components/motion'
import { CARD_PLACEHOLDER_HEIGHT, CardPlaceholder } from '@/features/cards/components/CardPlaceholder'
import { DrawnProvider } from '@/features/a2ui/catalog'
import { cn } from '@/lib/utils'

const arrived = new Set<string>()

export function forgetArrivals(messageId: string): void {
  const prefix = `${messageId}:`
  for (const key of arrived) if (key.startsWith(prefix)) arrived.delete(key)
}

export function resetArrivalsForTests(): void {
  arrived.clear()
}

const LiveContext = createContext(false)

export const CardSlotLiveProvider = LiveContext.Provider

export const useAnswerLive = (): boolean => useContext(LiveContext)

export const CardSlot = ({
  arrivalKey,
  children,
  refused = false,
  arriving,
}: {
  arrivalKey: string
  children?: ReactNode
  refused?: boolean
  arriving?: boolean
}) => {
  const live = useContext(LiveContext)
  const reducedMotion = useMotionToken(motionDeliberateEntrance) === motionInstant
  const [arrives] = useState(() => (arriving ?? live) && !reducedMotion && !arrived.has(arrivalKey))
  const [heldPlace] = useState(() => live && !reducedMotion && !refused)
  const [gone, setGone] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const [standing, setStanding] = useState(!arrives)
  const reveal = useCallback(() => {
    arrived.add(arrivalKey)
    setDrawn(true)
  }, [arrivalKey])

  const hasCard = !refused && children !== undefined && children !== null
  const neverComing = refused || (!hasCard && !live)
  if (neverComing && (!heldPlace || gone)) return null
  const shown = hasCard && (drawn || !arrives)
  const transition = arrives ? motionDeliberateEntrance : motionInstant

  return (
    <motion.div
      className={cn('relative mb-3', (!standing || neverComing) && 'overflow-hidden')}
      data-testid={hasCard ? undefined : 'pending-card-slot'}
      aria-busy={shown || neverComing ? undefined : true}
      initial={false}
      animate={
        neverComing
          ? { height: 0, opacity: 0, marginBottom: 0 }
          : { height: shown ? 'auto' : CARD_PLACEHOLDER_HEIGHT }
      }
      transition={neverComing ? motionQuickExit : transition}
      onAnimationComplete={() => (neverComing ? setGone(true) : setStanding(shown))}
    >
      {hasCard && (
        <motion.div initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={transition}>
          <DrawnProvider value={arrives ? reveal : null}>{children}</DrawnProvider>
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {!shown && (
          <motion.div
            key="placeholder"
            className="pointer-events-none absolute inset-0"
            exit={{ opacity: 0, transition: arrives ? motionQuickExit : motionInstant }}
          >
            <CardPlaceholder height="100%" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
