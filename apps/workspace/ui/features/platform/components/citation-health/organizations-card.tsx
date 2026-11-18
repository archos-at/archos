'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useNumberFormats } from '@/hooks/use-number-formats'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { cn } from '@/lib/utils'
import type { OrganizationDto } from '../../lib/citation-health-types'
import { SectionHeader } from './section-header'

type OrgSortKey = 'turns' | 'defectTurns' | 'errorTurns' | 'defectRate'

export function OrganizationsCard({
  organizations,
  total,
  locale,
}: {
  organizations: OrganizationDto[]
  total: number
  locale: string
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const { count, percent } = useNumberFormats(locale)
  const [sort, setSort] = useState<{ key: OrgSortKey; desc: boolean }>({
    key: 'defectTurns',
    desc: true,
  })

  const rows = useMemo(() => {
    const direction = sort.desc ? -1 : 1
    return [...organizations].sort((a, b) => direction * (a[sort.key] - b[sort.key]))
  }, [organizations, sort])

  const columns: { key: OrgSortKey; label: string; className?: string }[] = [
    { key: 'turns', label: t('citations.colTurns'), className: 'hidden sm:table-cell' },
    { key: 'defectTurns', label: t('citations.colDefects') },
    { key: 'errorTurns', label: t('citations.colErrors'), className: 'hidden sm:table-cell' },
    { key: 'defectRate', label: t('citations.colDefectRate') },
  ]

  const cell = (org: OrganizationDto, key: OrgSortKey): string =>
    key === 'defectRate' ? percent(org.defectRate) : count(org[key])

  return (
    <Card data-testid="citation-organizations">
      <SectionHeader
        title={t('citations.orgsTitle')}
        description={t('citations.orgsDescription')}
      />
      <CardContent>
        {organizations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('citations.orgsEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-full pl-0">{t('citations.colOrganization')}</TableHead>
                {columns.map((column) => {
                  const active = sort.key === column.key
                  const SortIcon = active && !sort.desc ? ArrowUp : ArrowDown
                  return (
                    <TableHead
                      key={column.key}
                      className={cn('text-right last:pr-0', column.className)}
                      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                    >
                      <button
                        type="button"
                        className={cn(
                          'hover:text-foreground inline-flex items-center gap-1 rounded-sm outline-none',
                          FOCUS_RING_INSET,
                          active && 'text-foreground'
                        )}
                        onClick={() =>
                          setSort((current) => ({
                            key: column.key,
                            desc: current.key === column.key ? !current.desc : true,
                          }))
                        }
                        aria-label={t('citations.sortBy', { column: column.label })}
                      >
                        {/* Leading, so the label's right edge lines up with the
                            right-aligned figures below it. */}
                        <SortIcon className={cn('size-3', !active && 'opacity-0')} aria-hidden />
                        {column.label}
                      </button>
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((org) => (
                <TableRow key={org.organizationId ?? 'unattributed'}>
                  <TableCell className="max-w-0 truncate pl-0 font-medium">
                    {org.name ?? org.organizationId ?? (
                      <span className="text-muted-foreground font-normal">
                        {t('citations.unattributed')}
                      </span>
                    )}
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn(
                        'w-20 whitespace-nowrap text-right tabular-nums last:pr-0 sm:w-24',
                        column.className
                      )}
                    >
                      {cell(org, column.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {total > organizations.length ? (
          <p className="text-muted-foreground mt-3 text-xs">
            {t('citations.shownOfTotal', {
              shown: count(organizations.length),
              total: count(total),
            })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
