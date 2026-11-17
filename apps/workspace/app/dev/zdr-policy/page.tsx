'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { ZdrGroupNotice, ZdrPolicySection, type ZdrCoverage } from '@/app/app/(shell)/organization/zdr-policy-section'

const CLEAR: ZdrCoverage = { status: 'checked', blockedGroups: [], unresolvedGroups: [] }
const BLOCKED: ZdrCoverage = {
  status: 'checked',
  blockedGroups: [
    { group: 'deep_research', modelId: 'vendor/router-mini', source: 'platform', reason: 'not_zdr' },
    { group: 'clarifier', modelId: 'vendor/chat-lite', source: 'org', reason: 'zdr_endpoint_lacks_capability' },
  ],
  unresolvedGroups: ['ingest_vlm'],
}
const UNKNOWN: ZdrCoverage = { status: 'unknown', blockedGroups: [], unresolvedGroups: [] }

const noop = async (): Promise<void> => undefined

export default function ZdrPolicyDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const states: Array<{ title: string; node: JSX.Element }> = [
    {
      title: 'On, every task covered',
      node: <ZdrPolicySection zdrOnly zdrApplicable provider={null} coverage={CLEAR} onChanged={noop} />,
    },
    {
      title: 'On, tasks blocked (row notices below)',
      node: (
        <>
          <ZdrPolicySection zdrOnly zdrApplicable provider={null} coverage={BLOCKED} onChanged={noop} />
          {['deep_research', 'clarifier', 'ingest_vlm'].map((group) => (
            <div key={group} className="rounded-md border p-3">
              <p className="text-sm font-medium">{group}</p>
              <ZdrGroupNotice groupId={group} coverage={BLOCKED} />
            </div>
          ))}
        </>
      ),
    },
    {
      title: 'On, ZDR list unreadable',
      node: <ZdrPolicySection zdrOnly zdrApplicable provider={null} coverage={UNKNOWN} onChanged={noop} />,
    },
    {
      title: 'Off',
      node: <ZdrPolicySection zdrOnly={false} zdrApplicable provider={null} coverage={null} onChanged={noop} />,
    },
    {
      title: 'Not applicable (own OpenAI key)',
      node: <ZdrPolicySection zdrOnly zdrApplicable={false} provider="openai" coverage={null} onChanged={noop} />,
    },
  ]

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8" data-testid="zdr-policy-preview">
      <h1 className="text-lg font-semibold">Organization — Zero data retention</h1>
      {states.map((state) => (
        <section key={state.title} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{state.title}</h2>
          {state.node}
        </section>
      ))}
    </main>
  )
}
