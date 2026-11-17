'use client'

import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Archive, FileText, Globe, Ruler, Scale } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SourceSignal, SourceTint } from '@/lib/source-kinds'

const SIGNAL_ICON: Record<SourceSignal, typeof Globe> = {
  law: Scale,
  project: FileText,
  office: Archive,
  auto: Globe,
  model: Ruler,
}

export const iconForTint = (tint: SourceTint): typeof Globe =>
  tint === 'oib' ? SIGNAL_ICON.law : SIGNAL_ICON[tint]

export const sourceSignalStyle = (signal: SourceTint): CSSProperties => ({
  backgroundColor: `var(--source-${signal}-tint, var(--muted))`,
  color: `var(--source-${signal}-text, var(--muted-foreground))`,
  borderColor: `color-mix(in oklch, var(--source-${signal}, var(--foreground)) 25%, transparent)`,
})

const chipClasses =
  'inline-flex h-6 max-w-full shrink-0 items-center gap-1 truncate whitespace-nowrap rounded-full ' +
  'border px-2.5 text-xs font-medium transition-[color,background-color,box-shadow,filter] duration-snap ease-out ' +
  'motion-reduce:transition-none ' +
  '[&>svg]:size-3 [&>svg]:shrink-0 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const chipTouchClasses = 'pointer-coarse:h-11 pointer-coarse:px-3.5'

interface SourceSignalChipSpanProps {
  signal: SourceTint
  children: ReactNode
  className?: string
  title?: string
}

export const SourceSignalChip = ({ signal, children, className, title }: SourceSignalChipSpanProps) => {
  const Icon = iconForTint(signal)
  return (
    <span className={cn(chipClasses, className)} style={sourceSignalStyle(signal)} title={title}>
      <Icon aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  )
}

interface SourceSignalChipLinkProps extends SourceSignalChipSpanProps {
  href: string
}

export const SourceSignalChipLink = ({
  signal,
  children,
  className,
  title,
  href,
}: SourceSignalChipLinkProps) => {
  const Icon = iconForTint(signal)
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(chipClasses, chipTouchClasses, 'hover:brightness-95 dark:hover:brightness-125', className)}
      style={sourceSignalStyle(signal)}
      title={title ?? href}
    >
      <Icon aria-hidden="true" />
      <span className="truncate">{children}</span>
    </a>
  )
}

interface SourceSignalChipToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  signal: SourceSignal
  active: boolean
}

export const SourceSignalChipToggle = forwardRef<HTMLButtonElement, SourceSignalChipToggleProps>(
  function SourceSignalChipToggle({ signal, active, className, children, ...props }, ref) {
    const Icon = SIGNAL_ICON[signal]
    const { borderColor, ...tint } = sourceSignalStyle(signal)
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        className={cn(
          chipClasses,
          chipTouchClasses,
          'cursor-pointer',
          active ? '' : 'border-transparent hover:border-border shadow-xs hover:shadow-xs',
          className
        )}
        style={active ? { ...tint, borderColor } : tint}
        {...props}
      >
        <Icon aria-hidden="true" />
        <span className="truncate">{children}</span>
      </button>
    )
  }
)
