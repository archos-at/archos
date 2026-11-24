'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Timer, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNumberFormats } from '@/hooks/use-number-formats'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { DefectSampleDto, Severity } from '../../lib/citation-health-types'
import { timingHref } from '../../lib/citation-health-links'
import { CopyableId } from '../copyable-id'
import { SectionHeader } from './section-header'
import { UtcTime } from './utc-time'

const SEVERITY_BADGE: Record<
  Severity,
  { icon: LucideIcon; variant: 'outline' | 'warning' | 'success'; className?: string }
> = {
  error: {
    icon: AlertTriangle,
    variant: 'outline',
    className: 'border-danger bg-danger-subtle text-error',
  },
  warn: { icon: AlertCircle, variant: 'warning' },
  info: { icon: Info, variant: 'outline', className: 'text-muted-foreground' },
  ok: { icon: CheckCircle2, variant: 'success' },
}

export function RecentCard({
  recent,
  locale,
  kindLabel,
  reasonLabel,
  scopeQuery,
}: {
  recent: DefectSampleDto[]
  locale: string
  kindLabel: (kind: string) => string
  reasonLabel: (reason: string) => string
  scopeQuery: string
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const { count } = useNumberFormats(locale)

  return (
    <Card data-testid="citation-recent">
      <SectionHeader
        title={t('citations.recentTitle')}
        description={t('citations.recentDescription')}
      />
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('citations.recentEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-0">{t('citations.colFinding')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('citations.colAgent')}</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  {t('citations.colAffected')}
                </TableHead>
                <TableHead className="hidden lg:table-cell">{t('citations.colReasons')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('citations.colTime')}</TableHead>
                <TableHead className="pr-0">{t('citations.colTurn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((event) => {
                const badge = SEVERITY_BADGE[event.severity]
                const BadgeIcon = badge.icon
                const reasons = event.reasons
                  ? Object.keys(event.reasons).map(reasonLabel).join(', ')
                  : ''
                return (
                  <TableRow key={event.id}>
                    <TableCell className="pl-0">
                      <Badge variant={badge.variant} className={badge.className}>
                        <BadgeIcon aria-hidden />
                        {kindLabel(event.kind)}
                      </Badge>
                      <p className="text-muted-foreground mt-1 text-xs md:hidden">
                        {t(`citations.agents.${event.agent}`)} ·{' '}
                        {t('citations.itemCount', { count: count(event.count) })}
                        <span className="sm:hidden">
                          {' · '}
                          <UtcTime iso={event.createdAt} locale={locale} />
                        </span>
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden whitespace-nowrap md:table-cell">
                      {t(`citations.agents.${event.agent}`)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {count(event.count)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground hidden max-w-64 truncate lg:table-cell"
                      title={reasons}
                    >
                      {reasons || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      <UtcTime iso={event.createdAt} locale={locale} />
                    </TableCell>
                    <TableCell className="pr-0">
                      <span className="inline-flex items-center">
                        <CopyableId
                          id={event.turnId}
                          copyLabel={t('citations.copyTurnId', { id: event.turnId })}
                          copiedLabel={t('citations.turnIdCopied')}
                          failedLabel={t('citations.copyFailed')}
                          idClassName="hidden sm:inline"
                        />
                        {event.conversationId ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground pointer-coarse:size-9 size-7"
                              >
                                <Link
                                  href={timingHref(event.conversationId, scopeQuery)}
                                  aria-label={t('citations.openTiming')}
                                >
                                  <Timer className="size-3.5" aria-hidden />
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('citations.openTiming')}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
