'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { PlatformOrgBudget } from '@/lib/budgets/platform-contract'
import { PlatformOrgBudgetDialog } from '../../app/(shell)/platform/platform-org-budget-dialog'

const BUDGET: PlatformOrgBudget = {
  organizationId: 'org_01HQZX3K8FELD',
  unit: 'credit',
  dailyLimit: 2500,
  monthlyLimit: 10000,
  explicit: true,
  dayUsed: 410,
  monthUsed: 6120,
  ingest: {
    unit: 'credit',
    monthlyAllowance: 50000,
    defaultMonthlyAllowance: 30000,
    defaultFactor: 3,
    explicit: true,
    monthUsed: 28740,
  },
  canManage: true,
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __platformOrgBudgetShim?: boolean }
  if (!w.__platformOrgBudgetShim) {
    w.__platformOrgBudgetShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/ingest-allowance')) return Response.json(BUDGET.ingest)
      if (url.includes('/api/platform/organizations/')) return Response.json(BUDGET)
      return real(input, init)
    }
  }
}

export default function PlatformOrgBudgetDevPage(): JSX.Element {
  const [open, setOpen] = useState(true)
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8" data-testid="platform-org-budget-preview">
      <div>
        <h1 className="text-lg font-semibold">Platform — an office&apos;s Kontingent</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The daily and monthly limits, and the monthly allowance for reading documents in, set by an operator.
        </p>
      </div>
      <Button className="self-start" onClick={() => setOpen(true)}>
        Open
      </Button>
      {open ? (
        <PlatformOrgBudgetDialog
          organization={{ id: BUDGET.organizationId, name: 'feld72 Architekten' }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </main>
  )
}
