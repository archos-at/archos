'use client'

/**
 * The project's mail address, where people learn it (DECISION §9, „Entry
 * points“): `InboundMailAddressDialog` from the upload menu („Per E-Mail
 * senden …“) and the E-Mail-Eingang's „Adresse“, the never-used list, the
 * project overview's tile (`InboundMailAddressTile`), and
 * `InboundMailAddressCard` in Settings › Dokumente, where a manager creates,
 * replaces or switches it off.
 *
 * Every one leads with what the address is FOR (the owner's review,
 * 2026-10-27): put it in Cc when writing to the authority, the structural
 * engineer or the client, and the answers arrive here to be filed. Then the
 * address in full and copyable (30 characters of token nobody types) and „Als
 * Kontakt sichern“ (a vCard, which makes forwarding from a phone one tap).
 * The safety is one sentence, last: nothing is filed until someone confirms.
 * Beside the address, what a mail can carry (25 MiB, about three quarters of
 * it for attachments once base64 has encoded them) and the upload for
 * anything larger, both read from `INBOUND_MAIL_MAX_MESSAGE_BYTES`.
 * How often the office's own domain signs its mail (RT-X6) is a manager's
 * fact, so only the settings card shows it, and only to a manager.
 *
 * Replacing the address is behind a warning that says everything it ends: the
 * old address refuses mail at once, and every „Folgen“ on the project stops.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AtSign, BookOpen, Check, CircleSlash, ContactRound, Copy, ExternalLink, Forward, MailPlus, RefreshCw, UserCheck } from 'lucide-react'
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
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { usePublicSiteUrl } from '@/shared/context'
import { publicSiteLink } from '@/shared/public-site'
import { type InboundMailAddressClient } from '../lib/client'
import { refusalOf } from '../lib/refusal'
import { inboundMailPaths } from '@/lib/inbound-mail/paths'
import { contactCard, contactCardFileName } from '../lib/vcard'
import { useInboundMailAddress, type AddressState } from '../hooks/use-inbound-mail-address'
import { FactLine, QuietPanel } from './inbound-mail-atoms'
import { OwnDomainDkimLine } from './own-domain-dkim-line'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'
import { settingsCopy } from '@/i18n/namespaces/settings'

function saveContact(address: string, projectName: string, name: string, note: string): void {
  const blob = new Blob([contactCard({ name, address, note })], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  startBrowserDownload(url, contactCardFileName(projectName))
  // The anchor has been clicked; the browser holds its own reference now.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Where the address was shown, for PostHog: which door people take to it. */
export type AddressSurface = 'dialog' | 'never_used' | 'overview' | 'settings'

/** What the address is for, in the office's own work: three lines, the promise last. */
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

/**
 * The address in full, a press copies it; each copy counted by the door it was
 * taken from. On a phone it wraps after the `+`, before the token's dot and
 * before the `@`, never inside the domain.
 */
function AddressValue({ value, surface, className }: { value: string; surface: AddressSurface; className?: string }): JSX.Element {
  return (
    <CopyableValue
      value={value}
      className={cn('text-foreground mx-0 text-left font-mono text-sm', className)}
      // Whether the address reaches anyone's Cc line: the first step of the funnel to the first mail.
      onCopied={() => capturePosthog('inbound_mail_address_copied', { surface })}
    >
      <EmailAddress address={value} />
    </CopyableValue>
  )
}

/** The one thing an unused address asks for: copy it into a Cc line. The press says it landed. */
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

/** „Als Kontakt sichern“: a vCard, which makes forwarding from a phone one tap. */
function SaveContactButton({ value, projectName, surface }: { value: string; projectName: string; surface: AddressSurface }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      // A sheet on the quiet panel it sits in (the panel is the secondary tone itself).
      className="bg-background hover:bg-accent"
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

/**
 * What a mail can carry, and the way past it: the limit a project address
 * takes, what of it attachments can fill, and Dateien, where the upload is.
 * `onLeave` closes whatever the line sits in (the dialog opened from that same
 * upload menu), so the link never lands behind it.
 */
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

/** The address itself, copyable and savable as a contact: shared by the dialog, the never-used list and the settings card. */
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
  /** The three lines of what it is for; off where the surrounding copy says it already. */
  showUses?: boolean
  /** The address itself; off where the page's header shows it already (the E-Mail-Eingang). */
  showValue?: boolean
  /** Closes what the block sits in when the upload link is followed. */
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
      {/* In a dialog's sheet the panel keeps its card: the sheet's own inset is its edge. */}
      <QuietPanel className={cn(surface === 'dialog' && 'phone:mx-0 phone:rounded-surface')}>
        {/* The eyebrow names the value; in the dialog its title already does. */}
        {surface !== 'dialog' && showValue && <SectionLabel as="p">{t('address.label')}</SectionLabel>}
        {showValue &&
          (surface === 'never_used' ? (
            // Never used, the address is the page's focal point: a size up, read here and copied by the button below.
            <p className="text-foreground font-mono text-base [overflow-wrap:anywhere]" data-testid="address-value">
              <EmailAddress address={value} />
            </p>
          ) : (
            <AddressValue value={value} surface={surface} className="w-full justify-between" />
          ))}
        <div className="flex flex-wrap gap-2">
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
            <> · {t('address.dropped', { count: address.droppedLast30Days, days: INBOUND_MAIL_ADDRESS_STATS_DAYS })}</>
          )}
        </p>
      </QuietPanel>
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

/**
 * The project overview's tile (Settings › Übersicht): the address where people
 * look at the project, with what it is for, copy and „Als Kontakt sichern“,
 * and the E-Mail-Eingang as the tile's link like every other tile's section.
 * Nothing until there is an address: creating one is the settings card's.
 */
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

/** The states with no address to show: loading, failed, none yet, not received here. */
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
  }
}

export interface InboundMailAddressDialogProps {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: InboundMailAddressClient
}

/** „Per E-Mail senden …“: the address to forward to, from the upload menu. */
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

export interface InboundMailAddressCardProps {
  projectId: string
  projectName: string
  client?: InboundMailAddressClient
}

/** Settings › Dokumente: the address, and for a manager, creating, replacing and switching it off. */
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
          </>
        ) : (
          <AddressStatus state={address.state} onRetry={() => void address.reload()} onCreate={actions.create} />
        )}
        {manage && (
          <div className="flex flex-wrap gap-2 pt-2" /* apart by space, no line */>
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm('rotate')} data-testid="address-rotate">
              <RefreshCw className="size-4" aria-hidden />
              {t('address.rotate')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm('switchOff')} data-testid="address-switch-off">
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
