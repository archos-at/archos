import type { JSX } from 'react'
import { cn } from '@/lib/utils'

export type StageTrackTone = 'moving' | 'settled' | 'stopped' | 'retired'

const TONE_FILL: Record<StageTrackTone, string> = {
  moving: 'bg-foreground',
  settled: 'bg-[var(--text-color-feedback-success)]',
  stopped: 'bg-[var(--signal-error)]',
  retired: 'bg-muted-foreground/50',
}

const TONE_OUTLINE: Record<StageTrackTone, string> = {
  moving: 'border-muted-foreground/70',
  settled: 'border-muted-foreground/70',
  stopped: 'border-[var(--signal-error)]',
  retired: 'border-muted-foreground/50',
}

export interface StageTrackProps {
  stages: readonly string[]
  reached: number
  active?: boolean
  halted?: boolean
  tone?: StageTrackTone
  labels?: readonly string[]
  current?: number
  className?: string
  'data-testid'?: string
}

export function StageTrack({
  stages,
  reached,
  active = false,
  halted = false,
  tone = 'moving',
  labels,
  current,
  className,
  'data-testid': testId,
}: StageTrackProps): JSX.Element {
  const segmentClass = (index: number): string => {
    const done = index < reached
    const next = index === reached
    return cn(
      'h-1 flex-1 rounded-none',
      done && TONE_FILL[tone],
      !done && 'bg-border',
      !done && next && active && cn(TONE_FILL[tone], 'opacity-40'),
      !done && next && halted && cn('border border-dashed bg-transparent', TONE_OUTLINE[tone]),
    )
  }

  if (labels) {
    return (
      <div
        aria-hidden
        className={cn('flex items-start gap-1', className)}
        data-testid={testId}
        data-reached={reached}
        data-active={active || undefined}
        data-halted={halted || undefined}
        data-tone={tone}
      >
        {stages.map((stage, index) => (
          <span key={stage} className="flex min-w-0 flex-auto flex-col gap-1">
            <span data-stage={stage} data-done={index < reached || undefined} className={cn(segmentClass(index), 'flex-none')} />
            <span
              data-stage-label={stage}
              data-current={index === current || undefined}
              className={cn(
                'truncate text-[10.5px] leading-tight whitespace-nowrap',
                index === current ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              {labels[index]}
            </span>
          </span>
        ))}
      </div>
    )
  }

  return (
    <div
      aria-hidden
      className={cn('flex items-center gap-1', className)}
      data-testid={testId}
      data-reached={reached}
      data-active={active || undefined}
      data-halted={halted || undefined}
      data-tone={tone}
    >
      {stages.map((stage, index) => (
        <span key={stage} data-stage={stage} data-done={index < reached || undefined} className={segmentClass(index)} />
      ))}
    </div>
  )
}
