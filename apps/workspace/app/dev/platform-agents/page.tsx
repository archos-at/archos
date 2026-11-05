'use client'

/**
 * Dev preview for Platform → Agents (ADR-0126, ADR-0154): the section in every
 * state the server can decide, from fixtures. Not linked from anywhere; 404s
 * outside development. Pinned to German, the product's primary language.
 */

import type { JSX, ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { PlatformConnect } from '@/features/agent-connect/components'
import { PLATFORM_CONNECT_FIXTURES } from '@/features/agent-connect/components/fixtures'
import { PLATFORM_MCP_RUNBOOK_URL } from '@/features/agent-connect/lib/guide'

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export default function PlatformAgentsDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main data-testid="platform-agents-preview" className="mx-auto flex max-w-3xl flex-col gap-10 p-4 text-foreground sm:p-8">
        <Section title="Konsole und Gateway eingerichtet">
          <PlatformConnect state={PLATFORM_CONNECT_FIXTURES.both} runbookHref={PLATFORM_MCP_RUNBOOK_URL} />
        </Section>
        <Section title="Nur die Konsole, Gateway nicht ausgerollt">
          <PlatformConnect state={PLATFORM_CONNECT_FIXTURES.consoleOnly} runbookHref={PLATFORM_MCP_RUNBOOK_URL} />
        </Section>
        <Section title="Keine externe Anmeldung in dieser Installation">
          <PlatformConnect state={PLATFORM_CONNECT_FIXTURES.neither} runbookHref={PLATFORM_MCP_RUNBOOK_URL} />
        </Section>
      </main>
    </I18nProvider>
  )
}
