'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ExternalLink, MessageSquareText } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { HoverPeekPanel } from '@/components/ui/hover-peek-panel'
import { useHoverPopover } from '@/hooks/use-hover-popover'
import { useTranslations } from '@/i18n'
import { intakeProfileStepCopy } from '@/i18n/namespaces/intake-profile-step'
import type { ProjectLawUse } from '@/lib/base-knowledge/wire/project-law'
import type { IntakeView } from '@/lib/project-intake/types'
import { cn } from '@/lib/utils'

type Law = NonNullable<IntakeView['applicableLaw']>
type Role = ProjectLawUse['role']

/** The gate states that name no law; each says why instead (`projectLawFor`). */
const REFUSALS = ['organization_unplaced', 'site_unknown', 'not_entitled', 'knowledge_unavailable', 'none'] as const
type Refusal = (typeof REFUSALS)[number]
const isRefusal = (gate: Law['gate']): gate is Refusal => (REFUSALS as readonly string[]).includes(gate)

/** Binding first, then guidance, then the rest: the order a person weighs them in. */
const ROLE_ORDER: readonly Role[] = ['binding', 'guidance', 'interpretation', 'authority_practice', 'information']
const legendOf = (role: Role): 'binding' | 'guidance' | 'other' => (role === 'binding' || role === 'guidance' ? role : 'other')

/** The role as a dot: filled binds, a ring guides, a dashed ring interprets or informs. */
function RoleDot({ role }: { role: Role }): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'border-primary inline-block size-[7px] shrink-0 rounded-full',
        role === 'binding' && 'bg-primary',
        role === 'guidance' && 'border-[1.5px]',
        legendOf(role) === 'other' && 'border-[1.5px] border-dashed',
      )}
    />
  )
}

const nameOf = (use: ProjectLawUse): string =>
  [use.designation ?? use.workId, use.editionLabel].filter(Boolean).join(' ')

/**
 * „Was für dieses Projekt gilt": the law at the project's site from the
 * platform's records (ADR-0175), one chip per edition the chain names, its role
 * in the dot. The server's read (`projectLawFor`), the same the turn reads, so
 * the page and the answer name the same law. Where the gate refuses, it says
 * why and what would change it; it never falls back to a list for every site.
 */
export function RulesCard({ view }: { view: IntakeView }): JSX.Element | null {
  const t = useTranslations(intakeProfileStepCopy)
  const law = view.applicableLaw
  if (!law) return null
  const uses = [...law.uses].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  const legends = [...new Set(uses.map((use) => legendOf(use.role)))]
  const refusal = isRefusal(law.gate) ? law.gate : uses.length === 0 ? 'empty' : null
  return (
    <section
      aria-labelledby="profile-rules-heading"
      className="bg-card border-border min-w-0 rounded-[14px] border px-4 py-4 md:px-[22px] md:py-[18px]"
      data-testid="profile-rules"
      data-gate={law.gate}
    >
      <h2 id="profile-rules-heading" className="text-sm font-medium">
        {t('rules.heading')}
      </h2>
      {refusal ? (
        <p className="text-muted-foreground mt-3 text-[13px]" data-testid="profile-rules-gate">
          {t(`rules.gate.${refusal}`)}
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {uses.map((use) => (
            <li key={`${use.workId}/${use.editionId ?? 'live'}`}>
              <LawChip projectId={view.projectId} use={use} factLabels={law.factLabels} />
            </li>
          ))}
        </ul>
      )}
      {!refusal && (
        <p className="text-muted-foreground mt-3 text-xs" data-testid="profile-rules-basis">
          {legends.map((legend) => t(`rules.legend.${legend}`)).join(' · ')}. {t('rules.basis')} {t('rules.disclaimer')}
        </p>
      )}
    </section>
  )
}

/**
 * Why a work applies to this project, or what would decide it (ADR-0176): the
 * building facts in the country's terms, then the provision the record cites.
 */
function ApplicabilityNote({ use, factLabels }: { use: ProjectLawUse; factLabels: Record<string, string> }): JSX.Element | null {
  const t = useTranslations(intakeProfileStepCopy)
  const applicability = use.applicability
  if (!applicability) return null
  const facts = (keys: readonly string[]) => keys.map((key) => factLabels[key] ?? key).join(', ')
  const why =
    applicability.verdict === 'applies'
      ? applicability.basis.length > 0 ? t('rules.applicability.applies', { facts: facts(applicability.basis) }) : null
      : applicability.open.length > 0
        ? t('rules.applicability.open', { facts: facts(applicability.open) })
        : t('rules.applicability.case')
  return (
    <div className="space-y-1 text-xs" data-testid="profile-rule-applicability">
      {why && <p>{why}</p>}
      {applicability.provision && (
        <p className="text-muted-foreground">{t('rules.applicability.provision', { provision: applicability.provision })}</p>
      )}
    </div>
  )
}

function LawChip({ projectId, use, factLabels }: { projectId: string; use: ProjectLawUse; factLabels: Record<string, string> }): JSX.Element {
  const t = useTranslations(intakeProfileStepCopy)
  const peek = useHoverPopover()
  const name = nameOf(use)
  const toCheck = use.applicability?.verdict === 'check'
  // The qualifier the turn reads goes with the role: „verbindlich, nicht kuratiert“; an open scope says „zu prüfen“.
  const role = [
    t(`rules.role.${use.role}`),
    use.qualifier ? t(`rules.qualifier.${use.qualifier}`) : null,
    toCheck ? t('rules.applicability.check') : null,
  ]
    .filter(Boolean)
    .join(', ')
  const question = t('rules.askQuestion', { name })
  return (
    <>
      <Chip
        asChild
        interactive
        variant="outline"
        className="bg-card h-7 gap-1.5 rounded-lg px-2.5 text-[13px] font-normal pointer-coarse:h-9"
      >
        <button
          type="button"
          aria-label={t('rules.chipAria', { name, role })}
          data-role={use.role}
          data-qualifier={use.qualifier ?? undefined}
          data-applicability={use.applicability?.verdict}
          data-testid={`profile-rule-${use.workId}-${use.editionId ?? 'live'}`}
          {...peek.triggerProps}
        >
          <RoleDot role={use.role} />
          <span>
            {name}
            {(use.role !== 'binding' || use.qualifier || toCheck) && <span className="text-muted-foreground">, {role}</span>}
          </span>
        </button>
      </Chip>
      <HoverPeekPanel peek={peek} className="w-72 space-y-2 p-3">
        <p className="text-sm font-medium">{name}</p>
        <p className="flex items-center gap-1.5 text-xs">
          <RoleDot role={use.role} />
          {role}
        </p>
        <ApplicabilityNote use={use} factLabels={factLabels} />
        <div className="flex flex-wrap gap-2 pt-1">
          {use.sourceUrl && (
            <Chip asChild interactive variant="outline" size="sm">
              <a href={use.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                {t('rules.source')}
              </a>
            </Chip>
          )}
          <Chip asChild interactive variant="outline" size="sm">
            <Link href={`/app/projects/${projectId}/chat?ask=${encodeURIComponent(question)}`}>
              <MessageSquareText aria-hidden />
              {t('rules.ask')}
            </Link>
          </Chip>
        </div>
      </HoverPeekPanel>
    </>
  )
}
