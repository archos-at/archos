'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AtSign, BookOpen, Check, CircleSlash, ContactRound, Copy, ExternalLink, Forward, MailPlus, Plus, RefreshCw, UserCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadError } from '@/components/ui/load-error'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { BentoTile } from '@/components/ui/bento'
import { CopyableValue } from '@/components/ui/copyable-value'
import { EmailAddress } from '@/components/ui/email-address'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { useLocale, useTranslations } from '@/i18n'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { capturePosthog } from '@/lib/analytics/posthog'
import { startBrowserDownload } from '@/lib/browser-download'
import type { InboundMailAddressView } from '@/lib/inbound-mail/inbound-mail-wire'
import {
  forwardingAddressesOf,
  forwardingListProblem,
  INBOUND_MAIL_FORWARDED_FROM_MAX,
  normalizeForwardingAddress,
} from '@/lib/inbound-mail/forwarding-addresses'
import {
  INBOUND_MAIL_ADDRESS_STATS_DAYS,
  INBOUND_MAIL_EXTERNAL_WAIT_DAYS,
  INBOUND_MAIL_MAX_ATTACHMENT_BYTES,
  INBOUND_MAIL_MAX_MESSAGE_BYTES,
} from '@/lib/inbound-mail/inbound-mail-vocabulary'
import { CLAUSE_JOIN, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePublicSiteUrl } from '@/shared/context'
import { publicSiteLink } from '@/shared/public-site'
import { type InboundMailAddressClient } from '../lib/client'
import { refusalOf } from '../lib/refusal'
import { inboundMailPaths } from '@/lib/inbound-mail/paths'
import { contactCard, contactCardFileName } from '../lib/vcard'
import { useInboundMailAddress, type AddressState } from '../hooks/use-inbound-mail-address'
import { FactLine } from './inbound-mail-atoms'
import { OwnDomainDkimLine } from './own-domain-dkim-line'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { settingsCopy } from '@/i18n/namespaces/settings'

function saveContact(address: string, projectName: string, name: string, note: string): void {
  const blob = new Blob([contactCard({ name, address, note })], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  startBrowserDownload(url, contactCardFileName(projectName))
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export type AddressSurface = 'dialog' | 'never_used' | 'overview' | 'settings'

function AddressUses(): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <ul className="flex flex-col gap-2" aria-label={t('address.usesLabel')} data-testid="address-uses">
      <li>
        <FactLine icon={AtSign} tone="default">
          {t('address.uses.cc')}
        </FactLine>
      </li>
      <li>
        <FactLine icon={Forward} tone="default">
          {t('address.uses.forward')}
        </FactLine>
      </li>
      <li>
        <FactLine icon={UserCheck} tone="default">
          {t('address.uses.held', { days: INBOUND_MAIL_EXTERNAL_WAIT_DAYS })}
        </FactLine>
      </li>
    </ul>
  )
}

function AddressValue({ value, surface, className }: { value: string; surface: AddressSurface; className?: string }): JSX.Element {
  return (
    <CopyableValue
      value={value}
      className={cn('text-foreground mx-0 text-left font-mono text-[13px] leading-5 font-normal', className)}
      onCopied={() => capturePosthog('inbound_mail_address_copied', { surface })}
    >
      <EmailAddress address={value} />
    </CopyableValue>
  )
}

function CopyAddressButton({ value, surface }: { value: string; surface: AddressSurface }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [copied, raise] = useTransientFlag()
  return (
    <Button
      type="button"
      size="sm"
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(() => {
          raise()
          capturePosthog('inbound_mail_address_copied', { surface })
        }, () => {})
      }
      data-testid="address-copy"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {t('address.copy')}
    </Button>
  )
}

function SaveContactButton({ value, projectName, surface }: { value: string; projectName: string; surface: AddressSurface }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        saveContact(value, projectName, t('address.contactName', { project: projectName }), t('address.contactNote'))
        capturePosthog('inbound_mail_address_contact_saved', { surface })
      }}
      data-testid="address-save-contact"
    >
      <ContactRound className="size-4" aria-hidden />
      {t('address.saveContact')}
    </Button>
  )
}

const MEBIBYTE = 1024 * 1024

export function AddressSizeLimit({ projectId, onLeave }: { projectId: string; onLeave?: () => void }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const mebibytes = (bytes: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.floor(bytes / MEBIBYTE))
  return (
    <p className="text-muted-foreground text-xs" data-testid="address-size-limit">
      {t('address.sizeLimit', { limit: mebibytes(INBOUND_MAIL_MAX_MESSAGE_BYTES), attachments: mebibytes(INBOUND_MAIL_MAX_ATTACHMENT_BYTES) })}{' '}
      <Button asChild variant="inline">
        <Link href={inboundMailPaths(projectId).files} onClick={onLeave} data-testid="address-upload-instead">
          {t('address.uploadInstead')}
        </Link>
      </Button>
    </p>
  )
}

export function InboundMailAddressBlock({
  address,
  projectId,
  projectName,
  surface,
  showUses = true,
  showValue = true,
  onLeave,
}: {
  address: InboundMailAddressView
  projectId: string
  projectName: string
  surface: AddressSurface
  showUses?: boolean
  showValue?: boolean
  onLeave?: () => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const guideUrl = publicSiteLink(usePublicSiteUrl(), 'projectMail', locale)
  if (address.state !== 'active' || !address.address) return <></>
  const value = address.address
  return (
    <div className="flex flex-col gap-4" data-testid="inbound-mail-address">
      {showUses && <AddressUses />}
      {/* Never used, the address is the page's one object: a white sheet on the paper. In a dialog the dialog is the sheet. */}
      <div className={cn('flex flex-col gap-2', surface === 'never_used' && 'bg-sheet rounded-surface p-4 shadow-sm')} data-testid="inbound-mail-address-panel">
        {/* The eyebrow names the value; in the dialog its title already does. */}
        {surface !== 'dialog' && showValue && <SectionLabel as="p">{t('address.label')}</SectionLabel>}
        {showValue &&
          (surface === 'never_used' ? (
            <p className="text-foreground font-mono text-[13px] leading-5 font-normal [overflow-wrap:anywhere]" data-testid="address-value">
              <EmailAddress address={value} />
            </p>
          ) : (
            <AddressValue value={value} surface={surface} className="w-full justify-between" />
          ))}
        <div className="flex flex-wrap gap-3">
          {surface === 'never_used' && <CopyAddressButton value={value} surface={surface} />}
          <SaveContactButton value={value} projectName={projectName} surface={surface} />
        </div>
        {/* Inside the panel under a centred empty state: outside it, a left-aligned line hung under centred words. */}
        {surface === 'never_used' && <AddressSizeLimit projectId={projectId} onLeave={onLeave} />}
        {/* Under the never-used list's own „Noch keine E-Mails“ the line would say it twice. */}
        <p className={cn('text-muted-foreground text-xs', surface === 'never_used' && !address.lastReceivedAt && address.droppedLast30Days === 0 && 'hidden')}>
          {address.lastReceivedAt
            ? t('address.lastReceived', { time: formatRelativeTime(address.lastReceivedAt, locale) })
            : t('address.nothingReceived')}
          {address.droppedLast30Days > 0 && (
            <>{CLAUSE_JOIN}{t('address.dropped', { count: address.droppedLast30Days, days: INBOUND_MAIL_ADDRESS_STATS_DAYS })}</>
          )}
        </p>
      </div>
      {surface !== 'never_used' && <AddressSizeLimit projectId={projectId} onLeave={onLeave} />}
      {guideUrl && (
        <Button asChild variant="inline" className="touch-target w-fit gap-1.5 text-xs [&_svg:not([class*='size-'])]:size-3.5">
          <a href={guideUrl} target="_blank" rel="noopener noreferrer">
            <BookOpen className="size-3.5" aria-hidden />
            {t('address.guide')}
            <ExternalLink className="text-muted-foreground size-3" aria-hidden />
            <span className="sr-only">{t('address.newTab')}</span>
          </a>
        </Button>
      )}
    </div>
  )
}

export interface InboundMailAddressTileProps {
  projectId: string
  projectName: string
  client?: InboundMailAddressClient
}

export function InboundMailAddressTile({ projectId, projectName, client }: InboundMailAddressTileProps): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const address = useInboundMailAddress(projectId, true, client)
  const ready = address.state.kind === 'ready' ? address.state.address : null
  if (!ready || ready.state !== 'active' || !ready.address) return null
  return (
    <BentoTile
      label={t('address.label')}
      icon={AtSign}
      span="wide"
      href={inboundMailPaths(projectId).list({ status: 'waiting', outcome: null })}
      linkLabel={t('address.openInbox')}
      data-testid="inbound-mail-address-tile"
    >
      <p className="text-sm">{t('address.tileLead')}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AddressValue value={ready.address} surface="overview" className="max-w-full" />
        <SaveContactButton value={ready.address} projectName={projectName} surface="overview" />
      </div>
      <AddressSizeLimit projectId={projectId} />
    </BentoTile>
  )
}

function AddressStatus({
  state,
  onRetry,
  onCreate,
}: {
  state: AddressState
  onRetry: () => void
  onCreate: (() => Promise<void>) | null
}): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const [creating, setCreating] = useState(false)
  if (state.kind === 'loading') {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label={t('address.label')}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    )
  }
  if (state.kind === 'error') return <LoadError title={t('address.loadError')} onRetry={onRetry} />
  const { address } = state
  if (address.state === 'unavailable') {
    return (
      <FactLine icon={CircleSlash} testId="address-unavailable">
        {t('address.unavailable')}
      </FactLine>
    )
  }
  if (address.state === 'none') {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="address-none">
        <p className="text-sm">{t('address.none')}</p>
        {onCreate && address.canManage ? (
          <BusyButton
            type="button"
            size="sm"
            busy={creating}
            busyLabel={t('address.createBusy')}
            icon={<MailPlus aria-hidden />}
            onClick={() => {
              setCreating(true)
              void onCreate().finally(() => setCreating(false))
            }}
            data-testid="address-create"
          >
            {t('address.create')}
          </BusyButton>
        ) : (
          <p className="text-muted-foreground text-xs">{t('address.noneMember')}</p>
        )}
      </div>
    )
  }
  return null
}

function useAddressActions(address: ReturnType<typeof useInboundMailAddress>) {
  const t = useTranslations(inboundMailCopy)
  const fail = (error: unknown): never => {
    toast.error(t(`refusals.${refusalOf(error)}`))
    throw error
  }
  return {
    create: async () => {
      await address.create().then(() => toast.success(t('address.created')), fail)
    },
    rotate: async () => {
      await address.rotate().then(() => toast.success(t('address.rotated')), fail)
    },
    remove: async () => {
      await address.remove().then(() => toast.success(t('address.switchedOff')), fail)
    },
    setForwardedFrom: async (forwardedFrom: readonly string[]) => {
      await address.setForwardedFrom(forwardedFrom).then(
        () => toast.success(t('address.forwards.saved')),
        (error: unknown) => {
          toast.error(t('address.forwards.failed'))
          throw error
        },
      )
    },
  }
}

export interface InboundMailAddressDialogProps {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: InboundMailAddressClient
}

export function InboundMailAddressDialog({ projectId, projectName, open, onOpenChange, client }: InboundMailAddressDialogProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const address = useInboundMailAddress(projectId, open, client)
  const actions = useAddressActions(address)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={t('address.cancel')} data-testid="inbound-mail-address-dialog">
        <DialogHeader>
          <DialogTitle>{t('address.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('address.dialogDescription')}</DialogDescription>
        </DialogHeader>
        {address.state.kind === 'ready' && address.state.address.state === 'active' ? (
          <InboundMailAddressBlock
            address={address.state.address}
            projectId={projectId}
            projectName={projectName}
            surface="dialog"
            onLeave={() => onOpenChange(false)}
          />
        ) : (
          <AddressStatus state={address.state} onRetry={() => void address.reload()} onCreate={actions.create} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CopyLineButton({ text, testId }: { text: string; testId: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [copied, raise] = useTransientFlag()
  return (
    <Button
      type="button"
      variant="inline"
      className="touch-target w-fit gap-1.5 text-xs"
      onClick={() => void navigator.clipboard?.writeText(text).then(raise, () => {})}
      data-testid={testId}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? t('address.setup.copied') : t('address.setup.copy')}
    </Button>
  )
}

function AddressSetup({ address }: { address: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const lines = [
    { key: 'cc', icon: AtSign, text: t('address.setup.cc', { address }) },
    { key: 'forward', icon: Forward, text: t('address.setup.forward', { address }) },
  ] as const
  return (
    <div className="flex flex-col gap-2" data-testid="address-setup">
      <SectionLabel as="p">{t('address.setup.title')}</SectionLabel>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-col gap-0.5" data-testid={`address-setup-${line.key}`}>
            <FactLine icon={line.icon} tone="default">
              <span className="[overflow-wrap:anywhere]">{line.text}</span>
            </FactLine>
            <CopyLineButton text={line.text} testId={`address-setup-${line.key}-copy`} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@')
  return at === -1 ? null : address.slice(at + 1)
}

function ForwardingAddresses({
  address,
  onSave,
}: {
  address: InboundMailAddressView & { address: string }
  onSave: (forwardedFrom: readonly string[]) => Promise<void>
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputId = `forwarded-from-${address.address}`
  const save = async (next: readonly string[]): Promise<boolean> => {
    const found = forwardingListProblem(next, domainOf(address.address))
    if (found) {
      setProblem(found === 'too_many' ? t('address.forwards.tooMany', { max: INBOUND_MAIL_FORWARDED_FROM_MAX }) : t(`address.forwards.${found === 'malformed' ? 'invalid' : 'projectAddress'}`))
      return false
    }
    setProblem(null)
    setSaving(true)
    try {
      await onSave(forwardingAddressesOf(next))
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }
  const add = async () => {
    if (normalizeForwardingAddress(draft) === '') return
    if (await save([...address.forwardedFrom, draft])) setDraft('')
  }
  return (
    <div className="flex flex-col gap-2" data-testid="address-forwards">
      <SectionLabel as="p">{t('address.forwards.title')}</SectionLabel>
      <p className="text-muted-foreground text-xs">{t('address.forwards.explain')}</p>
      {address.forwardedFrom.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label={t('address.forwards.title')}>
          {address.forwardedFrom.map((forward) => (
            <li key={forward} className="flex items-center justify-between gap-2 font-mono text-[13px] leading-5" data-testid="address-forward">
              <EmailAddress address={forward} />
              {address.canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label={t('address.forwards.remove', { address: forward })}
                  disabled={saving}
                  onClick={() => void save(address.forwardedFrom.filter((kept) => kept !== forward))}
                  data-testid="address-forward-remove"
                >
                  <X className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs" data-testid="address-forwards-none">{t('address.forwards.none')}</p>
      )}
      {address.canManage && (
        <Field>
          <FieldLabel htmlFor={inputId} className="sr-only">{t('address.forwards.label')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={inputId}
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              placeholder={t('address.forwards.placeholder')}
              aria-invalid={problem !== null}
              onChange={(event) => {
                setDraft(event.target.value)
                setProblem(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void add()
                }
              }}
              className="h-9"
              data-testid="address-forward-input"
            />
            <Button type="button" variant="secondary" size="sm" disabled={saving || draft.trim() === ''} onClick={() => void add()} data-testid="address-forward-add">
              <Plus className="size-4" aria-hidden />
              {t('address.forwards.add')}
            </Button>
          </div>
          {problem ? <FieldError data-testid="address-forward-problem">{problem}</FieldError> : <FieldDescription className="sr-only">{t('address.forwards.explain')}</FieldDescription>}
        </Field>
      )}
    </div>
  )
}

export interface InboundMailAddressCardProps {
  projectId: string
  projectName: string
  client?: InboundMailAddressClient
}

export function InboundMailAddressCard({ projectId, projectName, client }: InboundMailAddressCardProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const tSettings = useTranslations(settingsCopy)
  const address = useInboundMailAddress(projectId, true, client)
  const actions = useAddressActions(address)
  const [confirm, setConfirm] = useState<'rotate' | 'switchOff' | null>(null)
  const ready = address.state.kind === 'ready' ? address.state.address : null
  const manage = ready?.canManage === true && ready.state === 'active'

  return (
    <SettingsPanel
      title={tSettings('project.documents.inboundMailTitle')}
      description={tSettings('project.documents.inboundMailDescription')}
      data-testid="inbound-mail-address-card"
    >
      <div className="flex flex-col gap-4">
        {ready?.state === 'active' ? (
          <>
            <InboundMailAddressBlock address={ready} projectId={projectId} projectName={projectName} surface="settings" showUses={false} />
            {/* The office's own signing (RT-X6) is a manager's to fix, so only a manager reads it. */}
            {ready.canManage && <OwnDomainDkimLine share={ready.ownDomainVerifiedShare} />}
            {ready.address && <AddressSetup address={ready.address} />}
            {ready.address && <ForwardingAddresses address={{ ...ready, address: ready.address }} onSave={actions.setForwardedFrom} />}
          </>
        ) : (
          <AddressStatus state={address.state} onRetry={() => void address.reload()} onCreate={actions.create} />
        )}
        {manage && (
          <div className="flex flex-wrap gap-3 pt-2" /* apart by space, no line; tonal presses 12px apart */>
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm('rotate')} data-testid="address-rotate">
              <RefreshCw className="size-4" aria-hidden />
              {t('address.rotate')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm('switchOff')} data-testid="address-switch-off">
              <CircleSlash className="size-4" aria-hidden />
              {t('address.switchOff')}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm === 'rotate'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('address.rotateTitle')}
        description={t('address.rotateText')}
        confirmLabel={t('address.rotateConfirm')}
        cancelLabel={t('address.cancel')}
        tone="warning"
        onConfirm={actions.rotate}
        confirmTestId="address-rotate-confirm"
      />
      <ConfirmDialog
        open={confirm === 'switchOff'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('address.switchOffTitle')}
        description={t('address.switchOffText')}
        confirmLabel={t('address.switchOffConfirm')}
        cancelLabel={t('address.cancel')}
        tone="destructive"
        onConfirm={actions.remove}
        confirmTestId="address-switch-off-confirm"
      />
    </SettingsPanel>
  )
}
