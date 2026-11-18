'use client'

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Lock, Search, UserPlus, Users } from 'lucide-react'
import { collectPages } from '@/lib/api/offset-page'
import { cn } from '@/lib/utils'
import { useAppForm } from '@/components/form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldError } from '@/components/ui/field'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemList,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { LoadError } from '@/components/ui/load-error'
import { SearchField } from '@/components/ui/search-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { membersCopy } from '@/i18n/namespaces/members'
import { capturePosthog } from '@/lib/analytics/posthog'
import { MemberAvatar } from './project-members-form/member-avatar'
import type { Member, ProjectRole } from './project-members-form/member-types'
import { MemberSuggestField } from './project-members-form/member-suggest-field'
import { RoleSelectField } from './project-members-form/role-select-field'

interface ProjectMembersFormProps {
  projectId: string
  canManage: boolean
  currentMembershipId?: string | null
}

interface PendingRoleConfirm {
  title: string
  description: string
  confirmLabel: string
  tone: 'warning' | 'destructive'
  run: () => Promise<void>
}

const ROLE_VALUES: ProjectRole[] = [
  'project-viewer',
  'project-contributor',
  'project-editor',
  'project-admin',
]

const NO_ACCESS = 'none'

const searchSchema = z.object({
  query: z.string(),
})

export function ProjectMembersForm({
  projectId,
  canManage,
  currentMembershipId = null,
}: ProjectMembersFormProps): JSX.Element {
  const t = useTranslations(membersCopy)
  const tCommon = useTranslations(commonCopy)
  const roleLabel = (role: ProjectRole): string => t(`roles.${role}`)
  const roleDescription = (role: ProjectRole): string => t(`roleDescriptions.${role}`)
  const roleOptions = ROLE_VALUES.map((value) => ({
    value,
    label: roleLabel(value),
    description: roleDescription(value),
  }))

  const inviteSchema = z.object({
    email: z.string().min(1, t('validation.emailRequired')).email(t('validation.emailInvalid')),
    roleSlug: z.enum(['project-viewer', 'project-contributor', 'project-editor', 'project-admin']),
  })

  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingRoleConfirm | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const membersRef = useRef<Member[]>([])
  membersRef.current = members

  const searchForm = useAppForm({
    defaultValues: { query: '' },
    validators: { onChange: searchSchema },
  })
  const query = useStore(searchForm.store, (state) => state.values.query)

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const all = await collectPages<Member>(async (cursor) => {
        const params = new URLSearchParams({ scope: 'organization', limit: '200' })
        if (cursor) params.set('cursor', cursor)
        const response = await fetch(`/api/projects/${projectId}/members?${params}`)
        if (!response.ok) {
          throw new Error(t('errors.loadFailed'))
        }
        const data = (await response.json()) as { members?: Member[]; nextCursor?: string | null }
        return { items: data.members ?? [], nextCursor: data.nextCursor }
      })
      setMembers(all)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.loadFailed')
      setLoadError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, t])

  useEffect(() => {
    void load()
  }, [load])

  const assignRole = useCallback(
    async (organizationMembershipId: string, roleSlug: ProjectRole | ''): Promise<boolean> => {
      setUpdatingId(organizationMembershipId)
      setActionError(null)
      try {
        const response = await fetch(`/api/projects/${projectId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationMembershipId, roleSlug }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          const message =
            data?.details?.reason === 'last-admin'
              ? t('errors.lastAdmin')
              : data.error || t('errors.updateFailed')
          throw new Error(message)
        }

        setMembers((prev) =>
          prev.map((member) =>
            member.organizationMembershipId === organizationMembershipId
              ? { ...member, role: roleSlug || null }
              : member
          )
        )
        capturePosthog('project_member_access_changed', {
          change: roleSlug ? 'granted_or_updated' : 'removed',
          role: roleSlug || undefined,
        })
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : t('errors.updateFailed')
        setActionError(message)
        toast.error(message)
        return false
      } finally {
        setUpdatingId(null)
      }
    },
    [projectId, t]
  )

  const handleRosterRoleChange = (member: Member, nextRole: ProjectRole | ''): void => {
    const isSelf =
      currentMembershipId != null && member.organizationMembershipId === currentMembershipId
    if (!isSelf) {
      void assignRole(member.organizationMembershipId, nextRole)
      return
    }

    if (nextRole) {
      setPendingConfirm({
        title: t('confirm.selfChangeTitle'),
        description: t('confirm.selfChangeDescription', { role: roleLabel(nextRole) }),
        confirmLabel: t('confirm.selfChangeConfirm'),
        tone: 'warning',
        run: async () => {
          await assignRole(member.organizationMembershipId, nextRole)
        },
      })
    } else {
      setPendingConfirm({
        title: t('confirm.selfRemoveTitle'),
        description: t('confirm.selfRemoveDescription'),
        confirmLabel: t('confirm.selfRemoveConfirm'),
        tone: 'destructive',
        run: async () => {
          await assignRole(member.organizationMembershipId, nextRole)
        },
      })
    }
  }

  const inviteForm = useAppForm({
    defaultValues: { email: '', roleSlug: 'project-viewer' as ProjectRole },
    validators: { onChange: inviteSchema },
    onSubmit: async ({ value, formApi }) => {
      setInviteError(null)
      const email = value.email.trim().toLowerCase()
      const match = membersRef.current.find(
        (member) => (member.email ?? '').toLowerCase() === email
      )

      if (!match) {
        setInviteError(t('invite.notFound'))
        return
      }

      const grantAndAnnounce = async (): Promise<void> => {
        const ok = await assignRole(match.organizationMembershipId, value.roleSlug)
        if (ok) {
          toast.success(t('invite.success', { name: match.name, role: roleLabel(value.roleSlug) }))
          formApi.reset()
        }
      }

      if (!match.role) {
        await grantAndAnnounce()
        return
      }

      if (match.role === value.roleSlug) {
        setInviteError(
          t('invite.alreadyHasRole', { name: match.name, role: roleLabel(match.role) })
        )
        return
      }

      setPendingConfirm({
        title: t('confirm.roleChangeTitle'),
        description: t('confirm.roleChangeDescription', {
          name: match.name,
          from: roleLabel(match.role),
          to: roleLabel(value.roleSlug),
        }),
        confirmLabel: t('confirm.roleChangeConfirm', { role: roleLabel(value.roleSlug) }),
        tone: 'warning',
        run: grantAndAnnounce,
      })
    },
  })

  const filteredMembers = members.filter((member) => {
    const haystack = `${member.name} ${member.email ?? ''}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })

  const activeCount = members.filter((member) => member.role).length

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-[68px] rounded-control" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (loadError) {
    return (
      <LoadError title={t('errors.loadTitle')} description={loadError} onRetry={load} />
    )
  }

  return (
    <>
      <div className="flex flex-col gap-8">
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="text-muted-foreground size-4" aria-hidden />
                {t('invite.title')}
              </CardTitle>
              <CardDescription>{t('invite.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void inviteForm.handleSubmit()
                }}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <inviteForm.AppField name="email">
                    {() => (
                      <MemberSuggestField
                        label={t('invite.memberLabel')}
                        placeholder={t('invite.searchPlaceholder')}
                        members={members}
                        roleLabel={roleLabel}
                        containerClassName="flex-1"
                      />
                    )}
                  </inviteForm.AppField>
                  <inviteForm.AppField name="roleSlug">
                    {() => (
                      <RoleSelectField
                        label={t('invite.roleLabel')}
                        options={roleOptions}
                        containerClassName="sm:w-56"
                      />
                    )}
                  </inviteForm.AppField>
                </div>

                {inviteError && <FieldError>{inviteError}</FieldError>}

                <div className="flex justify-end">
                  <inviteForm.AppForm>
                    <inviteForm.SubmitButton>{t('invite.submit')}</inviteForm.SubmitButton>
                  </inviteForm.AppForm>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Alert>
            <Lock className="size-4" />
            <AlertTitle>{t('readOnly.title')}</AlertTitle>
            <AlertDescription>{t('readOnly.description')}</AlertDescription>
          </Alert>
        )}

        {actionError && (
          <Alert variant="destructive">
            <AlertTitle>{t('errors.actionTitle')}</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="[.border-b]:pb-4 gap-3 border-b py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <CardTitle className="flex items-center gap-2">
                  <Users className="text-muted-foreground size-4" aria-hidden />
                  {t('roster.title')}
                </CardTitle>
                <CardDescription>
                  {t('roster.counts', { active: activeCount, total: members.length })}
                </CardDescription>
              </div>

              <searchForm.AppField name="query">
                {(field) => (
                  <SearchField
                    type="text"
                    className="w-full sm:max-w-xs"
                    value={field.state.value}
                    onChange={(value) => field.handleChange(value)}
                    placeholder={t('roster.searchPlaceholder')}
                    label={t('roster.searchAria')}
                    clearLabel={t('roster.clearSearch')}
                    onClear={() => searchForm.setFieldValue('query', '')}
                  />
                )}
              </searchForm.AppField>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {members.length === 0 ? (
              <EmptyState
                variant="bare"
                icon={Users}
                title={t('roster.emptyTitle')}
                description={t('roster.emptyDescription')}
              />
            ) : filteredMembers.length === 0 ? (
              <EmptyState
                variant="bare"
                icon={Search}
                title={t('roster.noMatchTitle')}
                description={t('roster.noMatchDescription')}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => searchForm.setFieldValue('query', '')}
                  >
                    {t('roster.clearSearch')}
                  </Button>
                }
              />
            ) : (
              <ItemList>
                {filteredMembers.map((member) => {
                  const isUpdating = updatingId === member.organizationMembershipId
                  const isSelf =
                    currentMembershipId != null &&
                    member.organizationMembershipId === currentMembershipId
                  return (
                    <Item
                      key={member.organizationMembershipId}
                      className="flex-col items-stretch sm:flex-row sm:items-center"
                    >
                      <ItemMedia>
                        <MemberAvatar member={member} className="size-9" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{member.name}</span>
                          {isSelf && (
                            <Badge variant="outline" className="shrink-0">
                              {t('roster.youBadge')}
                            </Badge>
                          )}
                        </ItemTitle>
                        <ItemDescription>{member.email ?? member.userId}</ItemDescription>
                      </ItemContent>
                      <ItemActions className="ml-0 w-full justify-end sm:ml-auto sm:w-auto sm:min-w-[220px]">
                        {canManage ? (
                          <>
                            <span
                              className={cn(
                                'card-eyebrow text-muted-foreground duration-snap transition-opacity ease-out motion-reduce:transition-none',
                                !isUpdating && 'invisible'
                              )}
                              aria-hidden={!isUpdating}
                            >
                              {t('roster.saving')}
                            </span>
                            <Select
                              value={member.role || NO_ACCESS}
                              onValueChange={(value) =>
                                handleRosterRoleChange(
                                  member,
                                  value === NO_ACCESS ? '' : (value as ProjectRole)
                                )
                              }
                              disabled={isUpdating}
                            >
                              <SelectTrigger
                                className="w-full sm:w-[180px]"
                                aria-label={t('roster.roleForMember', { name: member.name })}
                              >
                                <SelectValue>
                                  {member.role
                                    ? roleLabel(member.role)
                                    : t('roster.noAccessOption')}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_ACCESS}>
                                  {t('roster.noAccessOption')}
                                </SelectItem>
                                {roleOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    <div className="flex flex-col gap-0.5 py-0.5 text-left">
                                      <span>{option.label}</span>
                                      <span className="text-muted-foreground text-xs font-normal">
                                        {option.description}
                                      </span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        ) : member.role ? (
                          <Chip variant="muted" className="shrink-0">
                            {roleLabel(member.role)}
                          </Chip>
                        ) : (
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {t('roster.noAccess')}
                          </span>
                        )}
                      </ItemActions>
                    </Item>
                  )
                })}
              </ItemList>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null)
        }}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description}
        confirmLabel={pendingConfirm?.confirmLabel ?? ''}
        cancelLabel={tCommon('actions.cancel')}
        tone={pendingConfirm?.tone ?? 'warning'}
        pending={isConfirming}
        onConfirm={async () => {
          const confirm = pendingConfirm
          if (!confirm) return
          setIsConfirming(true)
          try {
            await confirm.run()
          } finally {
            setIsConfirming(false)
            setPendingConfirm(null)
          }
        }}
      />
    </>
  )
}
