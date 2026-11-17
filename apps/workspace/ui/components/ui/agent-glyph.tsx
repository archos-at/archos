import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = {
  xs: 'size-5 [&_svg]:size-2.5',
  sm: 'size-6 [&_svg]:size-3',
  md: 'size-7 [&_svg]:size-3.5',
  lg: 'size-8 [&_svg]:size-4',
} as const

const TONES = {
  ink: 'bg-foreground text-background',
  outline: 'border border-border bg-card text-foreground',
} as const

export function AgentGlyph({
  size = 'sm',
  tone = 'ink',
  working,
  className,
  label,
}: {
  size?: keyof typeof SIZES
  tone?: keyof typeof TONES
  working?: boolean
  className?: string
  label?: string
}): JSX.Element {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-slot="agent-glyph"
      data-tone={tone}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        TONES[tone],
        SIZES[size],
        className
      )}
    >
      <Sparkles aria-hidden />
      {working && (
        <span
          aria-hidden
          className="border-foreground/50 absolute -inset-[3px] animate-caret-breathe rounded-full border motion-reduce:animate-none"
        />
      )}
    </span>
  )
}
