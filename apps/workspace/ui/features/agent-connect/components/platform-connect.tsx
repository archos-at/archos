'use client'

/**
 * Platform → Agents (ADR-0126, ADR-0154): how platform staff connect their own
 * AI assistant to the two MCP servers that are theirs, the operator console's
 * door and the cluster's own servers behind the platform MCP gateway.
 *
 * The profile's "Agent verbinden" serves an office; this serves the platform,
 * so it is its own section here, built from the same kit: Card, Alert, Tabs,
 * and the CodeBlock with its copy button. It draws a server-decided
 * {@link PlatformConnectState} and reads no environment itself, so
 * `/dev/platform-agents` renders every state from fixtures.
 */

import type { JSX } from 'react'
import { BookOpen, Check, Info, Network, ShieldCheck, TerminalSquare } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionLabel } from '@/components/ui/section-label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { CodeBlock } from '@/shared/components/CodeBlock'
import type { McpServerEntry, PlatformConnectState } from '../lib/platform-connect-state'

/** The client-side name of the console's server. */
const CONSOLE_SERVER_NAME = 'platform'

type ClientId = 'claudeCode' | 'cursor' | 'other'

const SNIPPETS: Record<ClientId, { language: string; value: (name: string, url: string) => string } | null> = {
  claudeCode: { language: 'bash', value: (name, url) => `claude mcp add --transport http ${name} ${url}` },
  cursor: { language: 'json', value: (name, url) => JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2) },
  other: null,
}
const CLIENTS = Object.keys(SNIPPETS) as ClientId[]

const CONSOLE_CAN = ['organizations', 'models', 'quality', 'knowledge', 'maintenance'] as const
const CONSOLE_STAYS = ['permissions', 'confirm', 'organization'] as const

export interface PlatformConnectProps {
  state: PlatformConnectState
  /** The operator runbook: WorkOS setup, stack keys, first-deploy checks. */
  runbookHref: string
}

/** One server's address and, per client, how to add it. */
function ServerSetup({ name, url, testId }: { name: string; url: string; testId: string }): JSX.Element {
  const t = useTranslations(platformCopy, 'agents')
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <CodeBlock value={url} language={t('urlCode')} className="!my-1" />
      <Tabs defaultValue={CLIENTS[0]}>
        <TabsList className="flex-wrap">
          {CLIENTS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`clients.${id}.name`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {CLIENTS.map((id) => {
          const snippet = SNIPPETS[id]
          return (
            <TabsContent key={id} value={id} className="flex flex-col gap-2 pt-2 text-sm">
              <p>{t(`clients.${id}.step`)}</p>
              {snippet && <CodeBlock value={snippet.value(name, url)} language={snippet.language} />}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}

function Notice({ prefix, testId }: { prefix: 'console.notConfigured' | 'cluster.notDeployed'; testId: string }): JSX.Element {
  const t = useTranslations(platformCopy, 'agents')
  return (
    <Alert variant="info" data-testid={testId}>
      <Info aria-hidden />
      <AlertTitle>{t(`${prefix}Title`)}</AlertTitle>
      <AlertDescription>{t(`${prefix}Body`)}</AlertDescription>
    </Alert>
  )
}

function Bullets({ group, keys }: { group: 'can' | 'stays'; keys: readonly string[] }): JSX.Element {
  const t = useTranslations(platformCopy, 'agents')
  const Icon = group === 'can' ? Check : ShieldCheck
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {keys.map((key) => (
        <li key={key} className="flex items-start gap-2">
          <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t(`console.${group}.${key}`)}</span>
        </li>
      ))}
    </ul>
  )
}

function ConsoleCard({ url }: { url: string | null }): JSX.Element {
  const t = useTranslations(platformCopy, 'agents')
  return (
    <Card data-testid="platform-connect-console">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalSquare className="text-muted-foreground size-4" aria-hidden />
          {t('console.title')}
        </CardTitle>
        <CardDescription>{t('console.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {url === null ? (
          <Notice prefix="console.notConfigured" testId="platform-connect-console-notice" />
        ) : (
          <section className="flex flex-col gap-1">
            <SectionLabel as="h3">{t('urlLabel')}</SectionLabel>
            <ServerSetup name={CONSOLE_SERVER_NAME} url={url} testId="platform-connect-console-setup" />
            <p className="text-muted-foreground text-xs">{t('signIn')}</p>
          </section>
        )}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <section className="flex flex-col gap-2">
            <SectionLabel as="h3">{t('console.can.title')}</SectionLabel>
            <Bullets group="can" keys={CONSOLE_CAN} />
          </section>
          <section className="flex flex-col gap-2">
            <SectionLabel as="h3">{t('console.stays.title')}</SectionLabel>
            <Bullets group="stays" keys={CONSOLE_STAYS} />
          </section>
        </div>
      </CardContent>
    </Card>
  )
}

function ClusterCard({ servers, runbookHref }: { servers: readonly McpServerEntry[]; runbookHref: string }): JSX.Element {
  const t = useTranslations(platformCopy, 'agents')
  return (
    <Card data-testid="platform-connect-cluster">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="text-muted-foreground size-4" aria-hidden />
          {t('cluster.title')}
        </CardTitle>
        <CardDescription>{t('cluster.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {servers.length === 0 ? (
          <Notice prefix="cluster.notDeployed" testId="platform-connect-cluster-notice" />
        ) : (
          <>
            {servers.map((server) => (
              <section key={server.name} className="flex flex-col gap-1">
                <SectionLabel as="h3">{t('cluster.serverLabel', { name: server.name })}</SectionLabel>
                <ServerSetup name={server.name} url={server.url} testId={`platform-connect-server-${server.name}`} />
              </section>
            ))}
            <p className="text-muted-foreground text-xs">{t('signIn')}</p>
          </>
        )}
        <p className="flex items-start gap-2 text-sm">
          <ShieldCheck className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t('cluster.access')}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <a href={runbookHref} target="_blank" rel="noreferrer">
              <BookOpen aria-hidden />
              {t('runbook')}
            </a>
          </Button>
          <span className="text-muted-foreground text-xs">{t('runbookHint')}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function PlatformConnect({ state, runbookHref }: PlatformConnectProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6" data-testid="platform-connect">
      <ConsoleCard url={state.consoleUrl} />
      <ClusterCard servers={state.servers} runbookHref={runbookHref} />
    </div>
  )
}
