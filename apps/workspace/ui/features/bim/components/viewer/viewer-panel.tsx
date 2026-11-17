'use client'

import type { JSX } from 'react'
import { X } from 'lucide-react'
import { type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ViewerSurface } from './viewer-surface'

export function ViewerSectionHeader({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      className={cn('sticky top-0 z-10 flex items-center gap-2 bg-card px-3 py-2.5', className)}
      {...props}
    />
  )
}

export function ViewerSectionBody({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div className={cn('p-3', className)} {...props} />
}

export interface ViewerSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  label: string
  action?: ReactNode
  children: ReactNode
  bodyClassName?: string
}

export function ViewerSection({
  label,
  action,
  children,
  bodyClassName,
  className,
  ...rest
}: ViewerSectionProps): JSX.Element {
  return (
    <section aria-label={label} className={cn('shrink-0 border-b border-border last:border-b-0', className)} {...rest}>
      <ViewerSectionHeader className="justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        {action}
      </ViewerSectionHeader>
      <ViewerSectionBody className={bodyClassName}>{children}</ViewerSectionBody>
    </section>
  )
}

export interface ViewerPanelProps {
  title: string
  subtitle?: ReactNode
  closeLabel: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  bodyClassName?: string
  className?: string
}

export function ViewerPanel({
  title,
  subtitle,
  closeLabel,
  onClose,
  children,
  footer,
  bodyClassName,
  className,
}: ViewerPanelProps): JSX.Element {
  return (
    <ViewerSurface
      aria-label={title}
      role="complementary"
      className={cn(
        'flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden',
        'animate-in fade-in-0 slide-in-from-right-2 duration-base ease-entrance motion-reduce:animate-none',
        className
      )}
    >
      <ViewerSectionHeader className="items-start border-b border-border">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-foreground pointer-coarse:line-clamp-2 pointer-coarse:break-words pointer-coarse:whitespace-normal" title={title}>
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-1 size-7 shrink-0 rounded-md"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </ViewerSectionHeader>
      <ViewerSectionBody className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>
        {children}
      </ViewerSectionBody>
      {/* Footer keeps the panel scale (`p-3` like header and body) — a tighter
          `p-2` here was a second padding hiding in the same card. */}
      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </ViewerSurface>
  )
}

export interface ViewerFieldProps {
  label: string
  children: ReactNode
}

export function ViewerField({ label, children }: ViewerFieldProps): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium break-words text-foreground">{children}</dd>
    </div>
  )
}

export function ViewerFieldGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="mb-3 last:mb-0">
      {/*
        Not uppercased. Half of these headings are exporter-authored set names
        — `Qto_WallBaseQuantities` — and `text-transform` turns those into
        QTO_WALLBASEQUANTITIES, which is louder than anything under it and
        shreds the only casing that made the name readable.
      */}
      <h3 className="text-muted-foreground mb-1 text-xs font-medium">{label}</h3>
      <dl>{children}</dl>
    </div>
  )
}
