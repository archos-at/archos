'use client'

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SearchField } from '@/components/ui/search-field'
import { Spinner } from '@/components/ui/spinner'
import { useChatStore } from '@/features/chat/store'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { membersCopy } from '@/i18n/namespaces/members'
import { assignPerson, listAssignmentCandidates, releasePerson } from '@/lib/assignments/client'
import type { FileAssignee } from './project-file-workspace'

export function AssignPopover({
  documentId,
  assignees,
  currentUserId,
  onChanged,
  onPick,
  pickOnly = false,
  access = 'read',
  self,
  triggerLabel,
  trigger,
}: {
  documentId: string
  assignees: readonly FileAssignee[]
  currentUserId?: string
  onChanged: (next: FileAssignee[]) => void
  onPick?: (person: FileAssignee) => void
  pickOnly?: boolean
  access?: 'read' | 'write'
  self?: FileAssignee | null
  triggerLabel?: string
  trigger?: ReactElement
}) {
  const t = useTranslations(filesCopy)
  const tPeople = useTranslations(membersCopy)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const sessionUserId = useChatStore((state) => state.currentUserId)
  const actorId = currentUserId ?? sessionUserId ?? undefined
  const alreadyMine = Boolean(actorId && assignees.some((person) => person.userId === actorId))
  const [people, setPeople] = useState<FileAssignee[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    void listAssignmentCandidates('document', documentId, { access })
      .then((candidates) => {
        if (cancelled) return
        setPeople(candidates)
      })
      .catch(() => {
        if (!cancelled) {
          setPeople([])
          setLoadError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, documentId, attempt, access])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return people.filter((person) => {
      if (!needle) return true
      const name = (person.name || '').toLowerCase()
      const email = (person.email || '').toLowerCase()
      return name.includes(needle) || email.includes(needle)
    })
  }, [people, query])

  const [failedWrite, setFailedWrite] = useState<{
    kind: 'assign' | 'unassign'
    userId: string
    name: string
  } | null>(null)

  const write = async (kind: 'assign' | 'unassign', targetUserId: string, name: string) => {
    setBusy(true)
    setFailedWrite(null)
    try {
      onChanged(
        kind === 'assign'
          ? await assignPerson('document', documentId, targetUserId)
          : await releasePerson('document', documentId, targetUserId)
      )
    } catch {
      setFailedWrite({ kind, userId: targetUserId, name })
    } finally {
      setBusy(false)
    }
  }

  const displayName = (person: FileAssignee): string => person.name || person.email || person.userId

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="secondary" size="sm">
            {triggerLabel ?? (assignees.length > 0 ? t('assignment.edit') : t('assignment.assign'))}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 space-y-2 p-3 duration-quick ease-out motion-reduce:animate-none"
      >
        {!pickOnly &&
          assignees.map((person) => {
            const label = person.name || person.email || person.userId
            return (
              <Item key={person.userId} className="gap-2 px-0 py-0">
                <ItemContent>
                  <ItemTitle className="font-normal">{label}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy}
                    aria-label={`${label} · ${t('assignment.unassigned')}`}
                    onClick={() => void write('unassign', person.userId, label)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </ItemActions>
              </Item>
            )
          })}
        {!pickOnly && actorId && !alreadyMine && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => void write('assign', actorId, t('assignment.assignToMe'))}
          >
            {t('assignment.assignToMe')}
          </Button>
        )}
        {pickOnly && onPick && self && !assignees.some((person) => person.userId === self.userId) && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            data-testid="assign-pick-self"
            onClick={() => {
              onPick(self)
              setOpen(false)
            }}
          >
            {t('assignment.assignToMe')}
          </Button>
        )}
        {failedWrite && (
          <div className="space-y-1.5" data-testid="assign-write-error">
            <FieldError>
              {t(failedWrite.kind === 'assign' ? 'assignment.assignError' : 'assignment.unassignError', {
                name: failedWrite.name,
              })}
            </FieldError>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7"
              disabled={busy}
              onClick={() => void write(failedWrite.kind, failedWrite.userId, failedWrite.name)}
            >
              {t('assignment.tryAgain')}
            </Button>
          </div>
        )}
        <SearchField
          type="text"
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          placeholder={tPeople('invite.searchPlaceholder')}
          label={tPeople('invite.searchPlaceholder')}
          clearLabel={t('browser.clearSearch')}
          inputClassName="h-8"
        />
        {/* As tall as its people, up to a list of about eight, then it scrolls:
            two names must not open a mostly empty box over the thread. */}
        <ScrollArea className="max-h-52">
          {loading && people.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Spinner size="sm" label={t('assignment.loadingPeople')} />
            </div>
          ) : loadError ? (
            <div className="space-y-1.5 px-1 py-2">
              <FieldError>{t('assignment.peopleLoadError')}</FieldError>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7"
                onClick={() => setAttempt((current) => current + 1)}
              >
                {t('assignment.tryAgain')}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground px-1 py-2 text-xs">{t('assignment.noPeople')}</p>
          ) : (
            filtered.map((person) => {
              const assigned = assignees.some((row) => row.userId === person.userId)
              return (
                <Item
                  key={person.userId}
                  asChild
                  className="w-full rounded-control px-2 py-1.5 transition-opacity duration-snap ease-out disabled:opacity-50 motion-reduce:transition-none"
                >
                  <button
                    type="button"
                    disabled={busy || (!pickOnly && assigned)}
                    onClick={() => {
                      if (onPick) {
                        onPick(person)
                        setOpen(false)
                        return
                      }
                      void write('assign', person.userId, displayName(person))
                    }}
                  >
                    <ItemContent>
                      <ItemTitle className="font-normal">{person.name || person.email}</ItemTitle>
                    </ItemContent>
                    {!pickOnly && assigned ? (
                      <ItemActions>
                        <span className="text-muted-foreground text-xs">{t('assignment.responsible')}</span>
                      </ItemActions>
                    ) : null}
                  </button>
                </Item>
              )
            })
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
