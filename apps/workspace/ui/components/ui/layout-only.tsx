'use client'

import type { JSX, ReactNode } from 'react'

import { useIsMobileOnceKnown } from '@/hooks/use-is-mobile-once-known'

type Wrapper = 'div' | 'span'

export function MobileLayoutOnly({ children, as: Tag = 'div' }: { children: ReactNode; as?: Wrapper }): JSX.Element | null {
  if (useIsMobileOnceKnown() === false) return null
  return (
    <Tag data-slot="mobile-layout-only" className="contents md:hidden">
      {children}
    </Tag>
  )
}

export function DesktopLayoutOnly({ children, as: Tag = 'div' }: { children: ReactNode; as?: Wrapper }): JSX.Element | null {
  if (useIsMobileOnceKnown() === true) return null
  return (
    <Tag data-slot="desktop-layout-only" className="contents max-md:hidden">
      {children}
    </Tag>
  )
}
