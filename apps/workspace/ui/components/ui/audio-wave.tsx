import { cn } from '@/lib/utils'

export interface AudioWaveProps {
  levels: readonly number[]
  className?: string
}

const MIN_BAR = 0.12

export function AudioWave({ levels, className }: AudioWaveProps) {
  return (
    <span aria-hidden="true" className={cn('inline-flex h-4 items-center gap-[2px]', className)}>
      {levels.map((level, index) => (
        <span
          key={index}
          className="h-full w-[2px] rounded-none bg-current transition-transform duration-snap ease-out motion-reduce:transition-none"
          style={{ transform: `scaleY(${Math.max(MIN_BAR, Math.min(1, level)).toFixed(2)})` }}
        />
      ))}
    </span>
  )
}
