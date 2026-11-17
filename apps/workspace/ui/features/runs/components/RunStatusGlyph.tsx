'use client'

import type { FC } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, XCircle } from 'lucide-react'
import type { Transition } from 'motion/react'

import { AnimatePresence, motion, motionInstant, motionSnap } from '@/components/motion'
import { Spinner } from '@/components/ui/spinner'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import type { RunStatus } from '@/lib/runs/run-ledger-types'
import { cn } from '@/lib/utils'

type IconStatus = Exclude<RunStatus, 'created' | 'running'>

const GLYPH_TONE: Record<IconStatus, string> = {
  waiting: 'text-brand',
  done: 'text-success',
  failed: 'text-error',
  cancelled: 'text-muted-foreground',
  interrupted: 'text-warning',
}

const GLYPH_ICON: Record<IconStatus, typeof Clock> = {
  waiting: Clock,
  done: CheckCircle2,
  failed: XCircle,
  cancelled: CircleSlash,
  interrupted: AlertTriangle,
}

const SIZE = {
  md: { slot: 'size-5', icon: 'size-5', spinner: 'sm' },
  sm: { slot: 'size-4', icon: 'size-4', spinner: 'xs' },
} as const

const glyphKey = (status: RunStatus): 'spinner' | IconStatus =>
  status === 'created' || status === 'running' ? 'spinner' : status

const swap = {
  hidden: { opacity: 0, scale: 0.6 },
  shown: { opacity: 1, scale: 1 },
  exit: (transition: Transition) => ({ opacity: 0, transition }),
}

export interface RunStatusGlyphProps {
  status: RunStatus
  spinnerLabel?: string
  size?: keyof typeof SIZE
  delay?: number
  className?: string
}

export const RunStatusGlyph: FC<RunStatusGlyphProps> = ({
  status,
  spinnerLabel,
  size = 'md',
  delay = 0,
  className,
}) => {
  const dims = SIZE[size]
  const reduced = useReducedMotion()
  const key = glyphKey(status)
  const Icon = key === 'spinner' ? null : GLYPH_ICON[key]
  const enter = reduced ? motionInstant : motionSnap
  const leave = reduced ? motionInstant : { ...motionSnap, delay }
  return (
    <span
      data-testid={`run-glyph-${status}`}
      className={cn(
        'relative flex shrink-0 items-center justify-center',
        dims.slot,
        key === 'spinner' ? 'text-muted-foreground' : GLYPH_TONE[key],
        className,
      )}
    >
      {/* `initial={false}`: a block that mounts finished shows its check, it
          does not pop it. `custom` is read by the LEAVING glyph's exit. */}
      <AnimatePresence mode="wait" initial={false} custom={leave}>
        <motion.span
          key={key}
          className="flex"
          variants={swap}
          initial="hidden"
          animate="shown"
          exit="exit"
          custom={leave}
          transition={enter}
        >
          {Icon ? (
            <Icon className={dims.icon} aria-hidden="true" />
          ) : (
            <Spinner
              size={dims.spinner}
              {...(spinnerLabel ? { label: spinnerLabel } : { 'aria-hidden': true })}
            />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
