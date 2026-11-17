'use client'

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { SidebarUserMenu } from '@/components/shell/sidebar-user-menu'

export default function UserMenuDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const header = useSearchParams()?.get('variant') === 'header'
  const driven = useRef(false)
  useEffect(() => {
    if (driven.current) return
    driven.current = true
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-testid="user-menu-preview"] button'
    )
    if (!trigger) return
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, [])

  return (
    <main
      data-testid="user-menu-preview"
      className={`bg-background text-foreground flex min-h-dvh p-8 ${header ? 'items-start justify-end' : 'items-end'}`}
    >
      <div className={header ? 'w-auto' : 'w-56'}>
        <SidebarUserMenu
          compact={header}
          menuSide={header ? 'bottom' : 'top'}
          menuAlign={header ? 'end' : 'start'}
          avatarSizeClass={header ? 'size-8' : undefined}
          user={{ name: 'Anna Berger', email: 'anna.berger@example.at' }}
          organizationName="Musterarchitektur ZT GmbH"
          authRequired
          canManageOrganization
          canViewOrganization
          canManagePlatform
        />
      </div>
    </main>
  )
}
