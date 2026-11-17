'use client'

import type { ComponentProps, JSX } from 'react'

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useStartDockShown } from '@/components/shell/start-dock'

export function PageDialog(props: ComponentProps<typeof Dialog>): JSX.Element {
  const besidePanel = useStartDockShown()
  return <Dialog modal={!besidePanel} {...props} />
}

export function PageDialogContent({ onInteractOutside, ...props }: ComponentProps<typeof DialogContent>): JSX.Element {
  const besidePanel = useStartDockShown()
  return (
    <DialogContent
      onInteractOutside={(event) => {
        onInteractOutside?.(event)
        if (besidePanel) event.preventDefault()
      }}
      {...props}
    />
  )
}
