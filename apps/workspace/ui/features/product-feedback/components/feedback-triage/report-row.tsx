'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { ChevronDown, Inbox, Mail } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Chip } from '@/components/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import {
  SUPPORT_TICKET_STATUSES,
  type ProductFeedbackKind,
  type ProductFeedbackReportView,
  type SupportTicketStatus,
} from '@/lib/product-feedback/types'
import { cn } from '@/lib/utils'
import { claimable } from '@/features/product-feedback/lib/ticket-claimability'
import { FEEDBACK_KIND_ICONS } from '../feedback-form'
import { CaseLine } from './case-line'
import { ExternalTextLink } from './external-text-link'

const STATUS_CHIP: Record<SupportTicketStatus, 'info' | 'warning' | 'default' | 'success' | 'muted'> = {
  new: 'info',
  open: 'warning',
  pending: 'default',
  on_hold: 'muted',
  resolved: 'success',
}

const KIND_CHIP: Record<ProductFeedbackKind, 'destructive' | 'default' | 'success' | 'secondary'> =
  {
    bug: 'destructive',
    idea: 'default',
    praise: 'success',
    question: 'secondary',
  }

export function ReportRow({
  report,
  focused = false,
  canTriage,
  busy,
  onStatusChange,
  canClaim = false,
  claiming = false,
  onClaim,
}: {
  report: ProductFeedbackReportView
  focused?: boolean
  canTriage: boolean
  busy: boolean
  onStatusChange: (status: SupportTicketStatus) => void
  canClaim?: boolean
  claiming?: boolean
  onClaim?: () => void
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  const { locale } = useLocale()
  const ref = React.useRef<HTMLLIElement>(null)
  const KindIcon = FEEDBACK_KIND_ICONS[report.kind]
  const { ticket } = report

  React.useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  const reporter = report.reporter.name ?? report.reporter.email ?? t('platform.unknownReporter')
  const organization = report.organizationName ?? t('platform.unknownOrganization')

  return (
    <li
      ref={ref}
      data-testid="feedback-report"
      data-report-id={report.id}
      data-focused={focused || undefined}
      className={cn('flex flex-col gap-3 py-4', focused && 'bg-muted/50 -mx-6 px-6')}
    >
      <div className="flex flex-wrap items-center gap-2">
        {focused ? (
          <Badge variant="outline" className="font-normal">
            <Inbox aria-hidden />
            {t('platform.linked')}
          </Badge>
        ) : null}
        {ticket?.number != null ? (
          <span className="text-foreground font-mono text-xs" data-testid="feedback-ticket-number">
            #{ticket.number}
          </span>
        ) : null}
        <Chip variant={KIND_CHIP[report.kind]} size="sm">
          <KindIcon aria-hidden />
          {t(`kinds.${report.kind}.label`)}
        </Chip>
        <span className="text-muted-foreground min-w-0 truncate text-xs">
          {t('platform.from', { name: reporter, organization })}
        </span>
        <TimeAgo
          date={report.createdAt}
          locale={locale}
          className="text-muted-foreground text-xs"
        />
        {ticket ? (
          <div className="ml-auto">
            {canTriage ? (
              <Select
                value={ticket.status}
                onValueChange={(value) => onStatusChange(value as SupportTicketStatus)}
                disabled={busy}
              >
                <SelectTrigger size="sm" aria-label={t('platform.statusLabel')} className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORT_TICKET_STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`statuses.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Chip variant={STATUS_CHIP[ticket.status]} size="sm">
                {t(`statuses.${ticket.status}`)}
              </Chip>
            )}
          </div>
        ) : null}
      </div>

      {/* The list reads as a queue: a few lines say which report it is, and the
          linked report shows in full. */}
      <p
        className={cn(
          'text-foreground whitespace-pre-wrap break-words text-sm leading-relaxed',
          !focused && 'line-clamp-3'
        )}
      >
        {report.message}
      </p>

      {ticket ? (
        <CaseLine
          ticket={ticket}
          canClaim={canClaim && claimable(ticket)}
          claiming={claiming}
          onClaim={onClaim}
        />
      ) : null}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {report.pagePath && (
          <span className="font-mono">{t('platform.onPage', { page: report.pagePath })}</span>
        )}
        {report.reporter.email ? (
          <a
            href={`mailto:${report.reporter.email}`}
            className="text-primary pointer-coarse:min-h-11 inline-flex items-center gap-1 hover:underline"
          >
            <Mail className="size-3.5" aria-hidden />
            {t('platform.contact')}
          </a>
        ) : (
          <span>{t('platform.noContact')}</span>
        )}
        {ticket ? (
          <ExternalTextLink href={ticket.url} testId="feedback-ticket-link">
            {t('platform.openInPosthog')}
          </ExternalTextLink>
        ) : report.posthogPersonUrl ? (
          <ExternalTextLink href={report.posthogPersonUrl} testId="feedback-recordings-link">
            {t('platform.recordingsLink')}
          </ExternalTextLink>
        ) : null}
      </div>

      {(report.context.userAgent || report.context.viewport) && (
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 group inline-flex items-center gap-1 text-xs">
            {t('platform.details')}
            <ChevronDown
              aria-hidden
              className="duration-quick size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {(
                [
                  [t('dialog.context.browser'), report.context.userAgent],
                  [t('dialog.context.screen'), report.context.viewport],
                  [t('dialog.context.locale'), report.context.locale],
                  [t('dialog.context.timeZone'), report.context.timeZone],
                ] as const
              )
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <React.Fragment key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </React.Fragment>
                ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  )
}
