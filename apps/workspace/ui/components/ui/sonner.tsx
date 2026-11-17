'use client'

import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const TOAST_DURATION_MS = 4000

function Toaster({ ...props }: ToasterProps) {
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light')

  React.useEffect(() => {
    const root = document.documentElement

    const updateTheme = () => {
      setTheme(root.classList.contains('dark') ? 'dark' : 'light')
    }

    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  return (
    <Sonner
      theme={theme}
      position="top-right"
      richColors={false}
      duration={TOAST_DURATION_MS}
      gap={8}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'text-popover-foreground rounded-surface shadow-md',
          default: 'bg-popover',
          loading: 'bg-popover',
          success: 'bg-popover [&_[data-icon]]:text-success',
          error: 'border border-danger bg-danger-subtle [&_[data-icon]]:text-error',
          warning: 'bg-popover [&_[data-icon]]:text-warning',
          info: 'bg-popover [&_[data-icon]]:text-info',
        },
      }}
      {...props}
    />
  )
}

function LayerToaster({ id, foot, ...props }: ToasterProps & { id: string; foot: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-50 h-0 [contain:layout] [&_[data-sonner-toast]]:pointer-events-auto">
      <Toaster id={id} position="bottom-center" offset={{ bottom: foot }} mobileOffset={{ bottom: foot }} {...props} />
    </div>
  )
}

export { LayerToaster, Toaster }
