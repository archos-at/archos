import type { JSX } from 'react'
import { type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type ShellContentWidth = 'default' | 'wide' | 'tool'

export interface ShellContentProps extends ComponentProps<'div'> {
  width?: ShellContentWidth
  fill?: boolean
}

export function ShellContent({
  width = 'default',
  fill = false,
  className,
  children,
  ...rest
}: ShellContentProps): JSX.Element {
  return (
    <div
      data-shell-content={width}
      className={cn(
        'mx-auto w-full px-4 md:px-8',
        width === 'tool' ? 'max-w-screen-2xl' : width === 'wide' ? 'max-w-6xl' : 'max-w-5xl',
        fill ? 'flex h-full min-h-0 flex-col py-4 md:py-6' : 'py-6 md:py-10',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
