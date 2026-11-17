import * as React from 'react'
import { Check, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOCUS_RING } from '@/components/ui/focus-ring'

export const COMMENT_PIN_ON_POINT = '-translate-y-full'

export interface CommentPinProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  number?: number
  color?: string
  proposed?: boolean
  done?: boolean
  active?: boolean
  pending?: boolean
  ghost?: boolean
  unread?: boolean
  as?: 'button' | 'span'
}

export const CommentPin = React.forwardRef<HTMLButtonElement, CommentPinProps>(function CommentPin(
  {
    number,
    color = 'var(--paper-ink)',
    proposed,
    done,
    active,
    pending,
    ghost,
    unread,
    as = 'button',
    className,
    style,
    type = 'button',
    ...props
  },
  ref
) {
  const filled = active && !proposed && !ghost
  const classes = cn(
    'relative inline-flex size-6 items-center justify-center rounded-full rounded-bl-none font-mono text-[11px] leading-none font-semibold tabular-nums',
    'border-2 transition-[scale,background-color,color] duration-snap ease-out motion-reduce:transition-none',
    proposed && 'border-dashed',
    done && 'opacity-60',
    ghost && 'border-dotted bg-white/45 shadow-none',
    ghost && active && 'bg-white',
    filled ? 'text-white' : !ghost && 'bg-white text-neutral-900',
    as === 'button' && 'hover:scale-110',
    active && 'scale-110 shadow-md',
    className
  )
  const pinStyle: React.CSSProperties = {
    borderColor: color,
    ...(ghost && !filled ? { color } : {}),
    ...(filled ? { backgroundColor: color } : {}),
    ...style,
  }
  const face = done ? (
    <Check className="size-3" strokeWidth={3} aria-hidden />
  ) : pending ? (
    <Plus className="size-3" strokeWidth={3} aria-hidden />
  ) : number === undefined ? null : (
    number
  )
  const dot = unread ? (
    <span
      data-slot="comment-pin-unread"
      aria-hidden
      className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-white bg-paper-ink"
    />
  ) : null
  if (as === 'span') {
    return (
      <span data-slot="comment-pin" aria-hidden className={cn(classes, 'pointer-events-none')} style={pinStyle}>
        {face}
        {dot}
      </span>
    )
  }
  return (
    <button
      ref={ref}
      type={type}
      data-slot="comment-pin"
      data-active={active || undefined}
      data-proposed={proposed || undefined}
      data-ghost={ghost || undefined}
      data-unread={unread || undefined}
      className={cn(classes, FOCUS_RING)}
      style={pinStyle}
      {...props}
    >
      {face}
      {dot}
    </button>
  )
})
