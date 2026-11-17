'use client'

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import { notFound } from 'next/navigation'
import { IfcCompliancePanel } from '@/features/bim/components/ifc-compliance-panel'
import type { BimRuleResultWithConfirmation } from '@/lib/bim/rules'

const RULE: BimRuleResultWithConfirmation = {
  ruleId: 'oib2-fire-resistance-load-bearing',
  confirmation: null,
  confirmationStale: false,
  richtlinie: 'OIB 2',
  clause: '3',
  titleDe: 'Tragende Bauteile — Feuerwiderstand',
  thresholdDe: 'Feuerwiderstand nach Gebäudeklasse (GK1 R 30 … GK5 REI 90)',
  applicable: true,
  notApplicableReason: undefined,
  passed: 0,
  failed: 0,
  undecidable: 34,
  failures: [],
  unknowns: [
    {
      status: 'undecidable',
      globalId: '0GridFixture00Wall0001',
      name: 'AW 38 Nord',
      storeyName: 'Erdgeschoss',
      reading: 'Kein Feuerwiderstand am Bauteil hinterlegt — erforderlich REI 60',
    },
  ],
  missing: [{ path: 'Pset_WallCommon.FireRating', elements: 34 }],
  truncated: false,
}

export default function BimConfirmationFailedPreviewPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <div
      data-testid="bim-confirmation-failed-preview"
      className="bg-background text-foreground min-h-dvh p-6"
    >
      <div className="mx-auto max-w-[820px]">
        <Driver />
      </div>
    </div>
  )
}

function Driver(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let stopped = false
    const press = (testId: string): boolean => {
      const button = root.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
      button?.click()
      return Boolean(button)
    }
    const tick = (): void => {
      if (stopped) return
      if (root.querySelector('[data-testid="bim-confirmation-failed"]')) return
      if (!press('bim-confirm-save')) press('bim-confirm-open')
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      stopped = true
    }
  }, [])

  return (
    <div ref={rootRef}>
      <IfcCompliancePanel
        rules={[RULE]}
        summary={null}
        shoppingList={[]}
        isLoading={false}
        error={null}
        projectId="p1"
        modelFilename="wohnhaus-beispielgasse_V3.ifc"
        missingFacts={[]}
        askHref="/app/projects/p1/chat?ask=x"
        bcfHref={null}
        onConfirm={() => Promise.reject(new Error('offline'))}
      />
    </div>
  )
}
