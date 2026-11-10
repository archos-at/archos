'use client'

/**
 * Platform → Länder (ADR-0165): each country's platform knowledge, and the
 * review queue that is the only way it changes.
 *
 * Reading order: the countries, one row each (what is released, what is open,
 * how many offices read it, what is overdue for a check); then the requests
 * waiting for review. Opening a request shows every claim with its sources and
 * the reviewer's verdict, and the next step it can take: review, approve,
 * publish to preview, publish to stable, roll back. Approve, publish and
 * rollback ask first, because each is the person's own decision and the last
 * two change what every entitled office reads. Read-only staff see everything
 * and none of the write controls.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Globe2, ListChecks, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { ChangeRequestView, PlatformKnowledgeOverview } from '@/lib/base-knowledge/platform/wire'

type Load<T> = { state: 'loading' } | { state: 'error'; status: number } | { state: 'ready'; value: T }

const BASE = '/api/platform/knowledge'

async function postJson(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** The route's own words for a refusal, or the status. */
async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? String(response.status)
}

function released(counts: Record<string, number>, t: Translator): string {
  const parts = (['territory', 'authority', 'work', 'edition', 'manifestation'] as const)
    .filter((type) => (counts[type] ?? 0) > 0)
    .map((type) => `${counts[type]} ${t(`countryKnowledge.types.${type}`)}`)
  return parts.length > 0 ? parts.join(' · ') : t('countryKnowledge.noneReleased')
}

function claimValue(value: unknown): string {
  if (value === null || value === undefined) return '–'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function CountryKnowledge(): JSX.Element {
  const t = useTranslations(platformCopy)
  const canManage = usePlatformCan(PLATFORM_PERMISSIONS.settingsManage)
  const [overview, setOverview] = useState<Load<PlatformKnowledgeOverview>>({ state: 'loading' })
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(BASE).catch(() => null)
    if (!response || !response.ok) {
      setOverview({ state: 'error', status: response?.status ?? 0 })
      return
    }
    setOverview({ state: 'ready', value: (await response.json()) as PlatformKnowledgeOverview })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (overview.state === 'error' && overview.status === 403) {
    return (
      <EmptyState icon={Globe2} title={t('countryKnowledge.disabledTitle')} description={t('countryKnowledge.disabledBody')} />
    )
  }

  const ready = overview.state === 'ready' ? overview.value : null
  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title={t('countryKnowledge.countriesTitle')}
        description={t('countryKnowledge.countriesDescription')}
        loading={overview.state === 'loading'}
        error={overview.state === 'error'}
        onRetry={() => void load()}
      >
        {ready ? (
          <Table data-testid="country-knowledge-countries">
            <TableHeader>
              <TableRow>
                <TableHead>{t('countryKnowledge.columns.country')}</TableHead>
                <TableHead>{t('countryKnowledge.columns.released')}</TableHead>
                <TableHead className="text-right">{t('countryKnowledge.columns.open')}</TableHead>
                <TableHead className="text-right">{t('countryKnowledge.columns.offices')}</TableHead>
                <TableHead className="text-right">{t('countryKnowledge.columns.overdue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.countries.map((country) => (
                <TableRow key={country.countryId}>
                  <TableCell className="font-medium">{country.countryId}</TableCell>
                  <TableCell>{released(country.released, t)}</TableCell>
                  <TableCell className="text-right tabular-nums">{country.openRequests}</TableCell>
                  <TableCell className="text-right tabular-nums">{country.entitledOffices}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {country.overdueEditions > 0 ? <Badge variant="warning">{country.overdueEditions}</Badge> : 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('countryKnowledge.queueTitle')}
        description={t('countryKnowledge.queueDescription')}
        loading={overview.state === 'loading'}
      >
        {ready && ready.queue.length === 0 ? (
          <EmptyState icon={ListChecks} title={t('countryKnowledge.queueEmpty')} />
        ) : null}
        {ready && ready.queue.length > 0 ? (
          <Table data-testid="country-knowledge-queue">
            <TableHeader>
              <TableRow>
                <TableHead>{t('countryKnowledge.columns.request')}</TableHead>
                <TableHead>{t('countryKnowledge.columns.country')}</TableHead>
                <TableHead className="text-right">{t('countryKnowledge.columns.records')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.queue.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">{request.title}</TableCell>
                  <TableCell>{request.countryId}</TableCell>
                  <TableCell className="text-right tabular-nums">{request.revisionCount}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(request.id)}>
                      {t('countryKnowledge.open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>

      <Sheet open={openId !== null} onOpenChange={(open) => (open ? null : setOpenId(null))}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {openId ? <ChangeRequestPanel id={openId} canManage={canManage} onChanged={() => void load()} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

type Step = 'approve' | 'preview' | 'stable' | 'rollback'

function ChangeRequestPanel({ id, canManage, onChanged }: { id: string; canManage: boolean; onChanged: () => void }): JSX.Element {
  const t = useTranslations(platformCopy)
  const [request, setRequest] = useState<Load<ChangeRequestView>>({ state: 'loading' })
  const [confirming, setConfirming] = useState<Step | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`${BASE}/change-requests/${id}`).catch(() => null)
    if (!response || !response.ok) return setRequest({ state: 'error', status: response?.status ?? 0 })
    setRequest({ state: 'ready', value: (await response.json()) as ChangeRequestView })
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true)
    try {
      const response = await postJson(`${BASE}/change-requests/${id}/${path}`, body)
      if (!response.ok) {
        toast.error(t('countryKnowledge.failed', { reason: await refusal(response) }))
        return
      }
      toast.success(done)
      await load()
      onChanged()
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const decide = (revisionId: string, claimPath: string, decision: 'accepted' | 'rejected') =>
    act('review', { decisions: [{ revisionId, claimPath, decision }] }, t('countryKnowledge.recorded'))

  if (request.state !== 'ready') {
    return <SectionCard loading={request.state === 'loading'} error={request.state === 'error'} onRetry={() => void load()} />
  }
  const view = request.value
  const submitted = view.status === 'submitted'
  const previewed = view.releases.some((move) => move.channel === 'preview' && move.action === 'publish')
  const steps: { step: Step; label: string; show: boolean }[] = [
    { step: 'approve', label: t('countryKnowledge.steps.approve'), show: submitted },
    { step: 'preview', label: t('countryKnowledge.steps.preview'), show: view.status === 'approved' && !previewed },
    { step: 'stable', label: t('countryKnowledge.steps.stable'), show: view.status === 'approved' && previewed },
    { step: 'rollback', label: t('countryKnowledge.steps.rollback'), show: view.status === 'published' },
  ]
  const run = (step: Step) => {
    if (step === 'approve') return act('decision', { decision: 'approve', role: 'domain_expert' }, t('countryKnowledge.done.approve'))
    if (step === 'rollback') return act('rollback', { reason: t('countryKnowledge.rollbackReason') }, t('countryKnowledge.done.rollback'))
    return act('publish', { channel: step }, t(`countryKnowledge.done.${step}`))
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="change-request-panel">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{view.title}</h2>
        <p className="text-sm text-muted-foreground">
          {view.countryId} · {t(`countryKnowledge.status.${view.status}`)}
        </p>
      </div>
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {steps
            .filter((entry) => entry.show)
            .map((entry) => (
              <Button key={entry.step} size="sm" disabled={busy} onClick={() => setConfirming(entry.step)}>
                {entry.label}
              </Button>
            ))}
        </div>
      ) : null}
      {view.revisions.map((revision) => (
        <SectionCard key={revision.revisionId} title={revision.recordId} description={t(`countryKnowledge.types.${revision.type}`)}>
          <Table>
            <TableBody>
              {revision.claims.map((claim) => (
                <TableRow key={claim.path}>
                  <TableCell className="w-40 align-top text-muted-foreground">{claim.path}</TableCell>
                  <TableCell className="break-all align-top">{claimValue(claim.value)}</TableCell>
                  <TableCell className="w-44 text-right align-top">
                    {claim.decision ? <Badge variant="outline">{t(`countryKnowledge.verdicts.${claim.decision}`)}</Badge> : null}
                    {canManage && submitted ? (
                      <span className="ml-2 inline-flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('countryKnowledge.accept')}
                          disabled={busy}
                          onClick={() => void decide(revision.revisionId, claim.path, 'accepted')}
                        >
                          <Check />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('countryKnowledge.reject')}
                          disabled={busy}
                          onClick={() => void decide(revision.revisionId, claim.path, 'rejected')}
                        >
                          <X />
                        </Button>
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {revision.citations.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('countryKnowledge.sources')}: {revision.citations.map((citation) => citation.url ?? citation.note).join(' · ')}
            </p>
          ) : null}
        </SectionCard>
      ))}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
        title={confirming ? t(`countryKnowledge.confirm.${confirming}.title`) : ''}
        description={confirming ? t(`countryKnowledge.confirm.${confirming}.body`) : ''}
        confirmLabel={confirming ? t(`countryKnowledge.steps.${confirming}`) : ''}
        cancelLabel={t('countryKnowledge.cancel')}
        tone={confirming === 'rollback' || confirming === 'stable' ? 'warning' : 'default'}
        onConfirm={() => (confirming ? void run(confirming) : undefined)}
      />
    </div>
  )
}
