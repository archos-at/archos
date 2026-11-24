'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { CircleHelp, CircleSlash, FileSearch, Plus, type LucideIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { usePlatformCan } from '@/features/platform/platform-access'
import { useNumberFormats } from '@/hooks/use-number-formats'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import type { MissingSourceDto } from '../../lib/citation-health-types'
import { ACTION_ANCHOR } from '../../lib/citation-health-links'
import { SectionHeader } from './section-header'
import { UtcTime } from './utc-time'

const MISSING_STATUS_ICON: Record<'absent' | 'present' | 'unknown', LucideIcon> = {
  absent: CircleSlash,
  present: FileSearch,
  unknown: CircleHelp,
}

export function MissingSourcesCard({
  sources,
  total,
  inventoryKnown,
  locale,
}: {
  sources: MissingSourceDto[]
  total: number
  inventoryKnown: boolean
  locale: string
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const can = { corpus: usePlatformCan(PLATFORM_PERMISSIONS.knowledgeWrite), norms: usePlatformCan(PLATFORM_PERMISSIONS.settingsManage) } // per page opened
  const { count } = useNumberFormats(locale)

  return (
    <Card data-testid="citation-missing-sources">
      <SectionHeader
        title={t('citations.missingTitle')}
        description={t('citations.missingDescription')}
      />
      <CardContent className="flex flex-col gap-3">
        {inventoryKnown ? null : (
          <Alert variant="warning" role="status">
            <CircleHelp aria-hidden />
            <AlertDescription className="text-current">
              {t('citations.missingInventoryUnknown')}
            </AlertDescription>
          </Alert>
        )}
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-full pl-0">{t('citations.missingColSource')}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t('citations.missingColKind')}
              </TableHead>
              <TableHead className="hidden text-right md:table-cell">
                {t('citations.missingColCited')}
              </TableHead>
              <TableHead className="hidden lg:table-cell">
                {t('citations.missingColStatus')}
              </TableHead>
              <TableHead className="hidden whitespace-nowrap xl:table-cell">
                {t('citations.missingColLastSeen')}
              </TableHead>
              <TableHead className="pr-0 text-right">
                <span className="sr-only sm:not-sr-only">{t('citations.missingColAction')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((candidate) => {
              const status =
                candidate.present === null ? 'unknown' : candidate.present ? 'present' : 'absent'
              const StatusIcon = MISSING_STATUS_ICON[status]
              const name = candidate.fileName ?? candidate.documentNumber ?? candidate.target
              const anchor =
                candidate.present === false ? ACTION_ANCHOR[candidate.action] : undefined
              const actionLabel = t(`citations.missingActions.${candidate.action}`)
              const cited = t('citations.missingCited', {
                turns: count(candidate.turns),
                organizations: count(candidate.organizations),
              })
              return (
                <TableRow key={candidate.target}>
                  <TableCell className="max-w-0 pl-0">
                    <p className="truncate font-medium" title={candidate.target}>
                      {name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs" title={candidate.target}>
                      {/* On a phone the hidden columns collapse into this line. */}
                      <span className="sm:hidden">
                        {t(`citations.missingKinds.${candidate.kind}`)} ·{' '}
                      </span>
                      <span className="md:hidden">{cited} · </span>
                      <span className="lg:hidden">{t(`citations.missingStatus.${status}`)}</span>
                      <span className="hidden lg:inline">
                        {name === candidate.target ? '' : candidate.target}
                      </span>
                    </p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline">{t(`citations.missingKinds.${candidate.kind}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden whitespace-nowrap text-right tabular-nums md:table-cell">
                    {cited}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap">
                      <StatusIcon className="size-3.5 shrink-0" aria-hidden />
                      {t(`citations.missingStatus.${status}`)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden xl:table-cell">
                    <UtcTime iso={candidate.lastSeenAt} locale={locale} />
                  </TableCell>
                  <TableCell className="pr-0 text-right">
                    {anchor && can[candidate.action === 'add_to_norm_catalog' ? 'norms' : 'corpus'] ? (
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(
                              candidate.documentNumber ?? candidate.fileName ?? candidate.target
                            )
                            .catch(() => undefined)
                        }}
                      >
                        <Link href={anchor} aria-label={actionLabel}>
                          <Plus className="size-3.5" aria-hidden />
                          <span className="hidden sm:inline">{actionLabel}</span>
                        </Link>
                      </Button>
                    ) : anchor ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled
                        aria-label={actionLabel}
                        title={t('citations.missingReadOnly')}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        <span className="hidden sm:inline">{actionLabel}</span>
                      </Button>
                    ) : (
                      <span className="text-muted-foreground whitespace-nowrap text-xs">
                        {actionLabel}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <p className="text-muted-foreground text-pretty text-xs leading-relaxed">
          {total > sources.length
            ? `${t('citations.shownOfTotal', { shown: count(sources.length), total: count(total) })} `
            : null}
          {can.corpus || can.norms ? t('citations.missingCaveat') : t('citations.missingReadOnly')}
        </p>
      </CardContent>
    </Card>
  )
}
