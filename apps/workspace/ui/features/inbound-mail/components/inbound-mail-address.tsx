'use client'

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AtSign,
  BookOpen,
  Check,
  CircleSlash,
  ContactRound,
  Copy,
  ExternalLink,
  MailPlus,
  RefreshCw,
  Send,
  Settings2,
} from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
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
import { SettingsPanel } from '@/components/settings/settings-panel'
import { useLocale, useTranslations } from '@/i18n'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { capturePosthog } from '@/lib/analytics/posthog'
import { startBrowserDownload } from '@/lib/browser-download'
import type { InboundMailAddressView } from '@/lib/inbound-mail/inbound-mail-wire'
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
import { AddressSetup, ForwardingAddresses } from './address-setup'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { settingsCopy } from '@/i18n/namespaces/settings'

function saveContact(address: string, projectName: string, name: string, note: string): void {
  const blob = new Blob([contactCard({ name, address, note })], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  startBrowserDownload(url, contactCardFileName(projectName))
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export type AddressSurface = 'dialog' | 'never_used' | 'overview' | 'settings'

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
    <div className="flex items-center">
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
        {copied ? t('address.copied') : t('address.copy')}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? t('address.copied') : ''}
      </span>
    </div>
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

function ShareButton({ value, projectName }: { value: string; projectName: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const subject = encodeURIComponent(t('address.share.subject', { project: projectName }))
  const body = encodeURIComponent(t('address.share.body', { address: value }))
  return (
    <Button asChild variant="secondary" size="sm">
      <a href={`mailto:?subject=${subject}&body=${body}`} data-testid="address-share">
        <Send className="size-4" aria-hidden />
        {t('address.share.label')}
      </a>
    </Button>
  )
}

function AddressHandOn({ value, projectName, surface }: { value: string; projectName: string; surface: AddressSurface }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const rows = [
    { key: 'contact', press: <SaveContactButton value={value} projectName={projectName} surface={surface} />, hint: t('address.contactHint') },
    { key: 'share', press: <ShareButton value={value} projectName={projectName} />, hint: t('address.share.hint') },
  ]
  return (
    <ul className="flex flex-col gap-2" data-testid="address-hand-on">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col items-start gap-1" data-testid={`address-hand-on-${row.key}`}>
          {row.press}
          <span className="text-muted-foreground text-xs">{row.hint}</span>
        </li>
      ))}
    </ul>
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

function GuideLink(): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const guideUrl = publicSiteLink(usePublicSiteUrl(), 'projectMail', locale)
  if (!guideUrl) return null
  return (
    <Button asChild variant="inline" className="touch-target w-fit gap-1.5 text-xs [&_svg:not([class*='size-'])]:size-3.5">
      <a href={guideUrl} target="_blank" rel="noopener noreferrer">
        <BookOpen className="size-3.5" aria-hidden />
        {t('address.guide')}
        <ExternalLink className="text-muted-foreground size-3" aria-hidden />
        <span className="sr-only">{t('address.newTab')}</span>
      </a>
    </Button>
  )
}

function LastReceived({ address }: { address: InboundMailAddressView }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  return (
    <p className="text-muted-foreground text-xs" data-testid="address-last-received">
      {address.lastReceivedAt ? t('address.lastReceived', { time: formatRelativeTime(address.lastReceivedAt, locale) }) : t('address.nothingReceived')}
      {address.droppedLast30Days > 0 && (
        <>
          {CLAUSE_JOIN}
          {t('address.dropped', { count: address.droppedLast30Days, days: INBOUND_MAIL_ADDRESS_STATS_DAYS })}
        </>
      )}
    </p>
  )
}

export function AddressNotPostfach({ className }: { className?: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <p className={cn('text-muted-foreground text-xs', className)} data-testid="address-not-postfach">
      {t('address.notPostfach')}
    </p>
  )
}

export function InboundMailAddressBlock({
  address,
  projectId,
  projectName,
  surface,
  setup,
  onLeave,
}: {
  address: InboundMailAddressView
  projectId: string
  projectName: string
  surface: Exclude<AddressSurface, 'overview'>
  setup?: ReactNode
  onLeave?: () => void
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  if (address.state !== 'active' || !address.address) return <></>
  const value = address.address
  const quietFirstVisit = surface === 'never_used' && !address.lastReceivedAt && address.droppedLast30Days === 0
  return (
    <div className="flex flex-col gap-4" data-testid="inbound-mail-address">
      {/* Never used, the address is the page's one object: a white sheet on the paper. In a dialog the dialog is the sheet. */}
      <div className={cn('flex flex-col gap-4', surface === 'never_used' && 'bg-sheet rounded-surface p-4 shadow-sm')} data-testid="inbound-mail-address-panel">
        <div className="flex flex-col gap-2">
          {/* The eyebrow names the value; in the dialog and on the settings card the title already does. */}
          {surface === 'never_used' && <SectionLabel as="p">{t('address.label')}</SectionLabel>}
          <p
            className={cn('text-foreground font-mono font-normal [overflow-wrap:anywhere]', surface === 'never_used' ? 'text-sm leading-5' : 'text-[13px] leading-5')}
            data-testid="address-value"
          >
            <EmailAddress address={value} />
          </p>
          <CopyAddressButton value={value} surface={surface} />
        </div>
        <AddressHandOn value={value} projectName={projectName} surface={surface} />
      </div>
      <div className="flex flex-col gap-1">
        <AddressSizeLimit projectId={projectId} onLeave={onLeave} />
        {/* Under the never-used page's own „Noch keine E-Mails“ the line would say it twice. */}
        {!quietFirstVisit && <LastReceived address={address} />}
      </div>
      {surface === 'dialog' && (
        <p className="text-muted-foreground text-xs" data-testid="address-held">
          {t('address.held', { days: INBOUND_MAIL_EXTERNAL_WAIT_DAYS })}
        </p>
      )}
      {surface !== 'settings' && <AddressNotPostfach />}
      <AddressSetup address={value} inSettings={surface === 'settings'}>
        {setup}
      </AddressSetup>
      <GuideLink />
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
          <DialogDescription data-testid="address-lead">{t('address.lead')}</DialogDescription>
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

function AddressManageMenu({ onRotate, onSwitchOff }: { onRotate: () => void; onSwitchOff: () => void }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <ActionMenu
      mode="dropdown"
      align="start"
      contentClassName="w-72"
      trigger={
        <Button type="button" variant="secondary" size="sm" className="w-fit" data-testid="address-manage">
          <Settings2 className="size-4" aria-hidden />
          {t('address.manage')}
        </Button>
      }
      entries={[
        { type: 'item', id: 'rotate', label: t('address.rotate'), hint: t('address.rotateHint'), icon: RefreshCw, onSelect: onRotate, testId: 'address-rotate' },
        { type: 'item', id: 'switch-off', label: t('address.switchOff'), hint: t('address.switchOffHint'), icon: CircleSlash, onSelect: onSwitchOff, testId: 'address-switch-off' },
      ]}
    />
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
      description={ready?.state === 'active' ? <span data-testid="address-lead">{t('address.lead')}</span> : undefined}
      data-testid="inbound-mail-address-card"
    >
      {ready?.state === 'active' && ready.address ? (
        <div className="flex flex-col gap-4">
        <InboundMailAddressBlock
          address={ready}
          projectId={projectId}
          projectName={projectName}
          surface="settings"
          setup={
            <>
              <ForwardingAddresses address={{ ...ready, address: ready.address }} onSave={actions.setForwardedFrom} />
              {/* The office's own signing (RT-X6) is a manager's to fix, so only a manager reads it. */}
              {ready.canManage && <OwnDomainDkimLine share={ready.ownDomainVerifiedShare} />}
            </>
          }
        />
        {manage && <AddressManageMenu onRotate={() => setConfirm('rotate')} onSwitchOff={() => setConfirm('switchOff')} />}
        </div>
      ) : (
        <AddressStatus state={address.state} onRetry={() => void address.reload()} onCreate={actions.create} />
      )}
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
