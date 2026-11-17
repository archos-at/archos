'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { useRouter } from 'next/navigation'

import { PageSheet } from '@/components/ui/page-sheet'
import { PAGE_SHEET_SKELETON_SLOT } from './page-sheet-skeleton'

const AT_REST = { y: 0, scrim: 1 }

function skeletonPlace(): { y: number; scrim: number } | undefined {
  if (typeof document === 'undefined' || typeof DOMMatrixReadOnly === 'undefined') return undefined
  const skeleton = document.querySelector(`[data-slot="${PAGE_SHEET_SKELETON_SLOT}"]`)
  const [scrim, panel] = skeleton?.children ?? []
  if (!scrim || !panel) return undefined
  const opacity = Number(getComputedStyle(scrim).opacity)
  return {
    y: new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42,
    scrim: Number.isFinite(opacity) ? opacity : 1,
  }
}

interface RoutePageSheetProps {
  title: string
  subtitle?: string
  closeLabel: string
  standalone?: boolean
  fallbackHref?: string
  headerActions?: React.ReactNode
  headerless?: boolean
  bodyClassName?: string
  children: React.ReactNode
}

export function RoutePageSheet({
  title,
  subtitle,
  closeLabel,
  standalone = false,
  fallbackHref = '/app/projects',
  headerActions,
  headerless,
  bodyClassName,
  children,
}: RoutePageSheetProps): JSX.Element {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const [enterFrom] = React.useState(() => (standalone ? AT_REST : skeletonPlace()))

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (!next) setOpen(false)
  }, [])

  const handleExitComplete = React.useCallback(() => {
    if (standalone) router.push(fallbackHref)
    else if (typeof window !== 'undefined' && window.history.length <= 1)
      router.push(fallbackHref)
    else router.back()
  }, [standalone, fallbackHref, router])

  return (
    <PageSheet
      open={open}
      onOpenChange={handleOpenChange}
      onExitComplete={handleExitComplete}
      enterFrom={enterFrom}
      title={title}
      subtitle={subtitle}
      closeLabel={closeLabel}
      headerActions={headerActions}
      headerless={headerless}
      bodyClassName={bodyClassName}
    >
      {children}
    </PageSheet>
  )
}
