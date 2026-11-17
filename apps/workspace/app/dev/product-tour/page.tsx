'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { OrgHeader } from '@/components/shell/org-header'
import { PhoneTabBar } from '@/components/shell/phone-tab-bar'
import { ShellContent } from '@/components/shell'
import { ProjectsGrid } from '@/components/projects/projects-grid'
import { EmptyState } from '@/components/ui/empty-state'
import { ProductTour, useStartProductTour } from '@/features/onboarding/components/product-tour'
import { NO_TOURS, type TourId } from '@/lib/onboarding/product-tour'
import type { JSX } from 'react'

const USER = { name: 'Anna Berger', email: 'anna.berger@example.at' }
const ORGANIZATION = 'Musterarchitektur ZT GmbH'
const PROJECTS = [{ id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' }]

function Replay(): null {
  const start = useStartProductTour()
  useEffect(() => {
    const timer = window.setTimeout(start, 400)
    return () => window.clearTimeout(timer)
  }, [start])
  return null
}

function Preview(): JSX.Element {
  const params = useSearchParams()
  const variant: TourId = params.get('variant') === 'project' ? 'project' : 'welcome'
  const joined = params.get('joined') === '1'
  const [handover] = useState(() => params.has('tour'))
  const flags = {
    canAccessOfficeShelf: params.get('office_shelf') !== '0',
    canAccessInbox: params.get('inbox') !== '0',
    canManageOrganization: params.get('member') !== '1',
  }
  const chrome = {
    user: USER,
    organizationName: ORGANIZATION,
    authRequired: false,
    canViewOrganization: true,
    canManagePlatform: false,
    ...flags,
  }

  return (
    <ProductTour
      {...flags}
      eligible={joined ? { welcome: true, project: true } : NO_TOURS}
      tourAt={() => variant}
    >
      {variant === 'project' ? (
        <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row">
          <AppSidebar projectId="p-1" projects={PROJECTS} showModels={false} showSkills={false} {...chrome} />
          <main className="bg-background relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <EmptyState
              variant="bare"
              icon={MessageSquare}
              title="Wohnbau Seestadt Baufeld D12"
              description="Chat placeholder — the real chat needs a backend."
              className="m-auto"
            />
          </main>
          <PhoneTabBar projectId="p-1" pathname="/app/projects/p-1/chat" canAccessOfficeShelf={flags.canAccessOfficeShelf} canAccessInbox={flags.canAccessInbox} />
        </div>
      ) : (
        <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
          <OrgHeader {...chrome} />
          <main className="bg-background relative flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ShellContent width="wide">
              <ProjectsGrid projects={[]} docCounts={{}} viewerActivity={{}} />
            </ShellContent>
          </main>
          <PhoneTabBar projectId={null} pathname="/app/projects" canAccessOfficeShelf={flags.canAccessOfficeShelf} canAccessInbox={flags.canAccessInbox} />
        </div>
      )}
      {!joined && !handover && <Replay />}
    </ProductTour>
  )
}

export default function ProductTourPreview(): JSX.Element {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
