'use client'

import type { JSX } from 'react'

import { motion, springGlide } from '@/components/motion'

export function RailActivePill({ pillId, at }: { pillId: string; at: string }): JSX.Element {
  return (
    <motion.span
      layoutId={pillId}
      layoutDependency={at}
      data-slot="rail-active-pill"
      aria-hidden
      className="bg-sheet absolute inset-0 rounded-control shadow-xs"
      transition={springGlide}
    />
  )
}
