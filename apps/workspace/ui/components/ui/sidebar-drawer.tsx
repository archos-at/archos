'use client'

import * as React from 'react'
import * as DrawerPrimitive from '@radix-ui/react-dialog'

import { cn } from '@/lib/utils'
import { OVERLAY_EXIT, OVERLAY_REDUCED } from '@/components/ui/overlay-motion'

export interface SidebarDrawer {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
}

export function SidebarDrawerPanel({
  drawer,
  side,
  children,
  ...props
}: React.ComponentProps<'div'> & { drawer: SidebarDrawer; side: 'left' | 'right' }): React.JSX.Element {
  return (
    <DrawerPrimitive.Root open={drawer.open} onOpenChange={drawer.onOpenChange}>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay
          data-slot="sidebar-drawer-overlay"
          className={cn(
            'bg-overlay fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=open]:duration-deliberate data-[state=open]:ease-entrance',
            OVERLAY_EXIT,
            OVERLAY_REDUCED,
          )}
        />
        <DrawerPrimitive.Content
          aria-describedby={undefined}
          data-slot="sidebar-drawer"
          data-side={side}
          className={cn(
            'text-sidebar-foreground bg-sidebar fixed inset-y-0 z-50 flex h-[var(--visual-viewport-bottom,100dvh)] w-[min(85vw,20rem)] flex-col outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-deliberate data-[state=open]:ease-entrance',
            side === 'left'
              ? 'left-0 pl-[env(safe-area-inset-left)] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left'
              : 'right-0 pr-[env(safe-area-inset-right)] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            OVERLAY_EXIT,
            OVERLAY_REDUCED,
          )}
        >
          <DrawerPrimitive.Title className="sr-only">{drawer.label}</DrawerPrimitive.Title>
          {/* A followed link closes the drawer, the same chat's next `?session=` included,
              which leaves the pathname as it was. */}
          <div
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
            className="flex h-full w-full flex-col"
            {...props}
            onClickCapture={(event) => {
              if (event.target instanceof Element && event.target.closest('a[href]')) drawer.onOpenChange(false)
            }}
          >
            {children}
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
