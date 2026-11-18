'use client'

import { AlertCircle, Check, ShieldAlert, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TransferSummary } from '../../lib/upload-progress'

export function TrayGlyph({ summary, offline }: { summary: TransferSummary; offline: boolean }) {
  const radius = 8
  const circumference = 2 * Math.PI * radius

  if (summary.isSettled) {
    const hasFailure = summary.failed > 0
    const hasHeld = !hasFailure && summary.held > 0
    return (
      <span
        aria-hidden
        data-testid="upload-tray-glyph"
        data-tone={hasFailure ? 'destructive' : hasHeld ? 'warning' : 'success'}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full',
          'animate-in zoom-in-75 fade-in-0 duration-base ease-entrance motion-reduce:animate-none',
          hasFailure
            ? 'bg-danger-subtle text-error'
            : hasHeld
              ? 'bg-warning-subtle text-warning'
              : 'bg-success-subtle text-success'
        )}
      >
        {hasFailure ? (
          <AlertCircle className="size-3.5" />
        ) : hasHeld ? (
          <ShieldAlert className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
      </span>
    )
  }

  if (offline) {
    return (
      <span
        aria-hidden
        data-testid="upload-tray-glyph"
        data-tone="offline"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-subtle text-warning"
      >
        <WifiOff className="size-3.5" />
      </span>
    )
  }

  const determinate = summary.stage === 'transferring' && summary.bytesPercent !== null
  const filled = determinate ? (summary.bytesPercent! / 100) * circumference : circumference * 0.28

  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cn('size-5 shrink-0 -rotate-90', !determinate && 'animate-spin')}
    >
      <circle cx="10" cy="10" r={radius} fill="none" strokeWidth="2.5" className="stroke-foreground/12" />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        className="stroke-primary transition-[stroke-dasharray] duration-deliberate ease-out motion-reduce:transition-none"
      />
    </svg>
  )
}
