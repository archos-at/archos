'use client'

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemList } from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { LimitEditor, readLimit, type PolicyDto } from '@/features/budgets/components/limit-editor'
import {
  Stat,
  UsageOverviewView,
  UsageSkeleton,
  useSpendFormat,
  type UsageResponse,
} from '@/features/budgets/components/usage-overview'

interface MemberDto {
  id: string
  email: string
  name: string | null
}

interface ProjectDto {
  id: string
  name: string
}

const policyLimitLabel = (
  policy: PolicyDto,
  perDay: string,
  perMonth: string,
  formatAmount: (value: number) => string
): string => {
  const parts: string[] = []
  if (policy.dailyLimit !== null)
    parts.push(`${formatAmount(Number.parseFloat(policy.dailyLimit))}/${perDay}`)
  if (policy.monthlyLimit !== null)
    parts.push(`${formatAmount(Number.parseFloat(policy.monthlyLimit))}/${perMonth}`)
  return parts.join(' · ') || '—'
}

export const BudgetUsageCard: FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [policies, setPolicies] = useState<PolicyDto[]>([])
  const [members, setMembers] = useState<MemberDto[]>([])
  const [projects, setProjects] = useState<ProjectDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const loaded = useRef(false)

  const [dailyLimit, setDailyLimit] = useState('')
  const [monthlyLimit, setMonthlyLimit] = useState('')
  const [savingLimits, setSavingLimits] = useState(false)
  const [selectedProject, setSelectedProject] = useState('')

  const load = useCallback(async () => {
    try {
      const [usageRes, budgetsRes] = await Promise.all([
        fetch('/api/organization/usage'),
        fetch('/api/organization/budgets'),
      ])
      if (!usageRes.ok || !budgetsRes.ok) throw new Error('load failed')
      const usageBody = (await usageRes.json()) as UsageResponse
      const budgetsBody = (await budgetsRes.json()) as {
        organization: { dailyLimit: number | null; monthlyLimit: number | null }
        policies?: PolicyDto[]
      }
      setUsage(usageBody)
      setPolicies((budgetsBody.policies ?? []).filter((policy) => policy.scope !== 'organization'))
      setDailyLimit(budgetsBody.organization.dailyLimit?.toString() ?? '')
      setMonthlyLimit(budgetsBody.organization.monthlyLimit?.toString() ?? '')
      setLoadFailed(false)
      loaded.current = true
    } catch {
      if (!loaded.current) setLoadFailed(true)
      else toast.error(t('budgets.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/organization/members')
      .then(async (res) => (res.ok ? ((await res.json()) as { members: MemberDto[] }).members : []))
      .then(setMembers)
      .catch(() => setMembers([]))
    fetch('/api/projects')
      .then(async (res) => (res.ok ? ((await res.json()) as ProjectDto[]) : []))
      .then((rows) => setProjects(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setProjects([]))
  }, [isAdmin])

  const memberRows = useMemo(() => {
    const spendByUser = new Map((usage?.perMember ?? []).map((entry) => [entry.userId, entry]))
    const known = new Set(members.map((member) => member.id))
    const rows = members.map((member) => ({ member, spend: spendByUser.get(member.id) ?? null }))
    for (const entry of usage?.perMember ?? []) {
      if (!known.has(entry.userId)) {
        rows.push({ member: { id: entry.userId, email: entry.userId, name: null }, spend: entry })
      }
    }
    return rows.sort((a, b) => (b.spend?.month.amount ?? 0) - (a.spend?.month.amount ?? 0))
  }, [members, usage])

  const memberPolicies = useMemo(
    () => new Map(policies.filter((p) => p.scope === 'member').map((p) => [p.subjectId, p])),
    [policies]
  )
  const projectPolicies = useMemo(() => policies.filter((p) => p.scope === 'project'), [policies])

  const orgDailyInput = readLimit(dailyLimit, locale)
  const orgMonthlyInput = readLimit(monthlyLimit, locale)

  const saveOrgLimits = useCallback(async () => {
    const daily = readLimit(dailyLimit, locale)
    const monthly = readLimit(monthlyLimit, locale)
    if (!daily.ok || !monthly.ok) return
    setSavingLimits(true)
    try {
      const res = await fetch('/api/organization/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'organization',
          dailyLimit: daily.value,
          monthlyLimit: monthly.value,
        }),
      })
      if (res.status === 422) {
        toast.error(t('budgets.limitsRejected'))
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t('budgets.limitsSaved'))
      await load()
    } catch {
      toast.error(t('budgets.limitsSaveError'))
    } finally {
      setSavingLimits(false)
    }
  }, [dailyLimit, monthlyLimit, locale, t, load])

  const { onOwnKey, formatBare, requestsLabel, unitWord } = useSpendFormat(usage?.unit ?? 'credit')

  if (loadFailed && !usage) {
    return (
      <LoadError
        title={t('budgets.loadError')}
        onRetry={() => {
          setLoadFailed(false)
          setLoading(true)
          return load()
        }}
      />
    )
  }

  if (loading || !usage) {
    return <UsageSkeleton />
  }

  const projectName = (id: string | null): string =>
    projects.find((p) => p.id === id)?.name ?? id ?? `(${t('budgets.subjectGone')})`

  return (
    <TooltipProvider delayDuration={100}>
      {/* `spend-viz` scopes the validated chart tokens (end of globals.css). */}
      <div className="spend-viz animate-in fade-in-0 duration-base flex min-h-[16rem] flex-col gap-5 ease-out motion-reduce:animate-none">
        <UsageOverviewView usage={usage} />

        {isAdmin && (
          <>
            <Separator />
            {/* Organization limits */}
            <div>
              <p className="text-sm font-medium">{t('budgets.limitsTitle')}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t(onOwnKey ? 'budgets.limitsDescriptionTokens' : 'budgets.limitsDescription')}
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field className="flex-1 sm:max-w-40">
                  <FieldLabel htmlFor="budget-daily">
                    {t('budgets.dailyLimit', { unit: unitWord })}
                  </FieldLabel>
                  <Input
                    id="budget-daily"
                    inputMode="decimal"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    placeholder={t('budgets.noLimitPlaceholder')}
                    aria-invalid={!orgDailyInput.ok || undefined}
                  />
                  {!orgDailyInput.ok && <FieldError>{t('budgets.limitInvalid')}</FieldError>}
                </Field>
                <Field className="flex-1 sm:max-w-40">
                  <FieldLabel htmlFor="budget-monthly">
                    {t('budgets.monthlyLimit', { unit: unitWord })}
                  </FieldLabel>
                  <Input
                    id="budget-monthly"
                    inputMode="decimal"
                    value={monthlyLimit}
                    onChange={(e) => setMonthlyLimit(e.target.value)}
                    placeholder={t('budgets.noLimitPlaceholder')}
                    aria-invalid={!orgMonthlyInput.ok || undefined}
                  />
                  {!orgMonthlyInput.ok && <FieldError>{t('budgets.limitInvalid')}</FieldError>}
                </Field>
                <Button
                  className="w-full sm:w-auto"
                  onClick={saveOrgLimits}
                  disabled={savingLimits || !orgDailyInput.ok || !orgMonthlyInput.ok}
                >
                  {t('budgets.saveLimits')}
                </Button>
              </div>
            </div>

            <Separator />
            {/* Member usage & limits table */}
            <div>
              <p className="text-sm font-medium">{t('budgets.membersTitle')}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('budgets.membersDescription')}
              </p>
              <ItemList as="ul" className="mt-3">
                {memberRows.map(({ member, spend }) => {
                  const policy = memberPolicies.get(member.id)
                  return (
                    <Item
                      as="li"
                      key={member.id}
                      className="flex-wrap gap-x-4 gap-y-2 px-3 py-2.5 sm:flex-nowrap"
                    >
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <p className="truncate text-sm">{member.name ?? member.email}</p>
                        {member.name && (
                          <p className="text-muted-foreground truncate text-xs">{member.email}</p>
                        )}
                      </div>
                      <div className="flex flex-1 items-center justify-between gap-4 sm:flex-none sm:justify-end">
                        <Stat label={t('budgets.today')}>
                          {spend ? formatBare(spend.day.amount) : '—'}
                        </Stat>
                        <Stat label={t('budgets.thisMonth')}>
                          {spend ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default">
                                  {formatBare(spend.month.amount)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{requestsLabel(spend.month.events)}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Stat>
                        <Stat label={t('budgets.limitLabel')}>
                          {policy ? (
                            policyLimitLabel(
                              policy,
                              t('budgets.perDay'),
                              t('budgets.perMonth'),
                              formatBare
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Stat>
                        <LimitEditor
                          scope="member"
                          subjectId={member.id}
                          subjectLabel={member.name ?? member.email}
                          current={policy}
                          unitWord={unitWord}
                          onSaved={load}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t('budgets.setLimit')}
                              aria-label={`${t('budgets.setLimit')}: ${member.email}`}
                            >
                              <Pencil className="text-muted-foreground size-3.5" aria-hidden />
                            </Button>
                          }
                        />
                      </div>
                    </Item>
                  )
                })}
              </ItemList>
            </div>

            <Separator />
            {/* Project limits */}
            <div>
              <p className="text-sm font-medium">{t('budgets.scopedTitle')}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('budgets.scopedDescription')}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={selectedProject || undefined} onValueChange={setSelectedProject}>
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue placeholder={t('budgets.selectProject')} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedProject && (
                  <LimitEditor
                    scope="project"
                    subjectId={selectedProject}
                    subjectLabel={projectName(selectedProject)}
                    current={projectPolicies.find((p) => p.subjectId === selectedProject)}
                    unitWord={unitWord}
                    onSaved={load}
                    trigger={
                      <Button variant="secondary" className="w-full sm:w-auto">
                        {t('budgets.setLimit')}
                      </Button>
                    }
                  />
                )}
              </div>
              {projectPolicies.length > 0 && (
                <ItemList as="ul" className="mt-3">
                  {projectPolicies.map((policy) => (
                    <Item as="li" key={policy.id} className="flex-wrap gap-x-4 gap-y-1 px-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {projectName(policy.subjectId)}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {policyLimitLabel(
                          policy,
                          t('budgets.perDay'),
                          t('budgets.perMonth'),
                          formatBare
                        )}
                      </span>
                      <LimitEditor
                        scope="project"
                        subjectId={policy.subjectId as string}
                        subjectLabel={projectName(policy.subjectId)}
                        current={policy}
                        unitWord={unitWord}
                        onSaved={load}
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            title={t('budgets.setLimit')}
                            aria-label={`${t('budgets.setLimit')}: ${projectName(policy.subjectId)}`}
                          >
                            <Pencil className="text-muted-foreground size-3.5" aria-hidden />
                          </Button>
                        }
                      />
                    </Item>
                  ))}
                </ItemList>
              )}
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
