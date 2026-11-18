'use client'

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FOCUS_RING_INSET } from '@/components/ui/focus-ring'
import { SectionLabel } from '@/components/ui/section-label'
import { StatCardIcon, type StatCardIconTone } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { cn } from '@/lib/utils'
import type { FindingCopy, FindingDto, FindingSeverity } from '../../lib/citation-health-types'
import { SectionHeader } from './section-header'

const FINDINGS_VISIBLE = 3

const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warn: 1, info: 2 }

const FINDING_STYLE: Record<FindingSeverity, { icon: LucideIcon; tone: StatCardIconTone }> = {
  error: { icon: AlertTriangle, tone: 'destructive' },
  warn: { icon: AlertCircle, tone: 'warning' },
  info: { icon: Info, tone: 'muted' },
}

function FindingRow({
  finding,
  copy,
  nextStepLabel,
  severityLabel,
}: {
  finding: FindingDto
  copy: FindingCopy
  nextStepLabel: string
  severityLabel: string
}): JSX.Element {
  const style = FINDING_STYLE[finding.severity]
  return (
    <Collapsible asChild>
      <li className="group/finding">
        <CollapsibleTrigger
          className={cn(
            'duration-snap hover:bg-hover flex w-full items-start gap-3 px-6 py-3 text-left transition-colors motion-reduce:transition-none',
            'outline-none',
            FOCUS_RING_INSET
          )}
        >
          <StatCardIcon icon={style.icon} tone={style.tone} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="sr-only">{severityLabel}: </span>
            <span className="block text-sm font-medium">{copy.title}</span>
            <span className="text-muted-foreground mt-0.5 block text-sm group-data-[state=closed]/finding:line-clamp-1">
              {copy.meaning}
            </span>
          </span>
          <ChevronDown
            className="text-muted-foreground duration-base mt-1.5 size-4 shrink-0 transition-transform group-data-[state=open]/finding:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-4 pl-16 pr-6">
          <SectionLabel as="p">{nextStepLabel}</SectionLabel>
          <p className="mt-1 text-pretty text-sm leading-relaxed">{copy.action}</p>
        </CollapsibleContent>
      </li>
    </Collapsible>
  )
}

export function FindingsCard({
  findings,
  copyFor,
}: {
  findings: FindingDto[]
  copyFor: (finding: FindingDto) => FindingCopy
}): JSX.Element | null {
  const t = useTranslations(platformCopy)
  const [expanded, setExpanded] = useState(false)
  const sorted = useMemo(
    () =>
      findings
        .filter((finding) => finding.id !== 'all_clear')
        .map((finding, index) => ({ finding, index }))
        .sort(
          (a, b) =>
            SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
            a.index - b.index
        )
        .map(({ finding }) => finding),
    [findings]
  )
  const allClear = findings.find((finding) => finding.id === 'all_clear')

  if (sorted.length === 0 && !allClear) return null

  const visible = expanded ? sorted : sorted.slice(0, FINDINGS_VISIBLE)
  const hidden = sorted.length - FINDINGS_VISIBLE

  return (
    <Card data-testid="citation-findings">
      <SectionHeader
        title={t('citations.findingsTitle')}
        description={t('citations.findingsDescription')}
      />
      <CardContent className="px-0">
        {sorted.length === 0 && allClear ? (
          <div className="flex items-start gap-3 border-t px-6 pt-4" role="status">
            <StatCardIcon icon={CheckCircle2} tone="success" size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{copyFor(allClear).title}</p>
              <p className="text-muted-foreground mt-0.5 text-sm">{copyFor(allClear).meaning}</p>
            </div>
          </div>
        ) : (
          <>
            <ul className="divide-y border-y">
              {visible.map((finding) => (
                <FindingRow
                  key={finding.id}
                  finding={finding}
                  copy={copyFor(finding)}
                  nextStepLabel={t('citations.findingsNextStep')}
                  severityLabel={t(`citations.severity.${finding.severity}`)}
                />
              ))}
            </ul>
            {hidden > 0 ? (
              <div className="px-6 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((value) => !value)}
                  aria-expanded={expanded}
                >
                  <ChevronDown
                    className={cn(
                      'duration-base size-3.5 transition-transform motion-reduce:transition-none',
                      expanded && 'rotate-180'
                    )}
                    aria-hidden
                  />
                  {expanded
                    ? t('citations.findingsLess')
                    : t('citations.findingsMore', { count: hidden })}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
