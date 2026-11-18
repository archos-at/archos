import { type ReactNode, forwardRef } from 'react'
import type { Transition } from 'motion/react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleArrowRight,
  CircleHelp,
  CircleMinus,
  CircleSlash,
  Clock,
  TriangleAlert,
} from 'lucide-react'
import { motion, useIconSwapTransition } from '@/components/motion'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { useTranslations } from '@/i18n'
import { type HeaderStatus, isSettledAnswer } from '../../lib/derivation-header'

interface StatusIconProps {
  status: HeaderStatus
  t: ReturnType<typeof useTranslations>
  enter: Transition
  leave: Transition
}

export const StatusIcon = forwardRef<HTMLSpanElement, StatusIconProps>(function StatusIcon(
  { status, t, enter, leave },
  ref
) {
  const settled = isSettledAnswer(status)
  const iconSwap = useIconSwapTransition()
  const glyph: Record<HeaderStatus, ReactNode> = {
    live: <Spinner size="sm" label={t('thinking.inProgress')} />,
    waiting: <Clock className="size-5" aria-hidden="true" />,
    recovering: <Spinner size="sm" aria-hidden="true" />,
    interrupted: <AlertTriangle className="size-5" aria-hidden="true" />,
    stopped: <CircleSlash className="size-5" aria-hidden="true" />,
    failed: <AlertTriangle className="size-5" aria-hidden="true" />,
    handedOff: <CircleArrowRight className="size-5" aria-hidden="true" />,
    refused: <CircleMinus className="size-5" aria-hidden="true" />,
    askedBack: <CircleHelp className="size-5" aria-hidden="true" />,
    flagged: <TriangleAlert className="size-5" aria-hidden="true" />,
    done: <CheckCircle2 className="size-5" aria-hidden="true" />,
  }
  const tone: Record<HeaderStatus, string> = {
    live: '',
    waiting: 'text-brand',
    recovering: 'text-muted-foreground',
    interrupted: 'text-warning',
    stopped: 'text-muted-foreground',
    failed: 'text-warning',
    handedOff: 'text-brand',
    refused: 'text-muted-foreground',
    askedBack: 'text-brand',
    flagged: 'text-warning',
    done: 'text-success',
  }
  return (
    <motion.span
      ref={ref}
      className={cn('flex size-5 shrink-0 items-center justify-center', tone[status])}
      initial={settled ? { opacity: 0, scale: 0.7 } : { opacity: 0 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: settled ? iconSwap.enter : enter,
      }}
      exit={{ opacity: 0, transition: leave }}
    >
      {glyph[status]}
    </motion.span>
  )
})
