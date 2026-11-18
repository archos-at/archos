'use client'

import type { JSX } from 'react'
import {
  Building2,
  Cpu,
  FileDown,
  FileWarning,
  Gauge,
  HardDrive,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { SectionNav } from '@/components/shell/section-nav'

export const ORGANIZATION_SECTIONS = [
  { key: 'overview', href: '/app/organization', icon: Building2 },
  { key: 'access', href: '/app/organization/access', icon: Users },
  { key: 'models', href: '/app/organization/models', icon: Cpu },
  { key: 'budgets', href: '/app/organization/budgets', icon: Gauge },
  { key: 'storage', href: '/app/organization/storage', icon: HardDrive },
  { key: 'screening', href: '/app/organization/screening', icon: ScanSearch },
  { key: 'quarantine', href: '/app/organization/quarantine', icon: FileWarning },
  { key: 'downloads', href: '/app/organization/download-log', icon: FileDown },
  { key: 'compliance', href: '/app/organization/compliance', icon: ScrollText },
  { key: 'enterprise', href: '/app/organization/enterprise', icon: ShieldCheck },
] as const satisfies readonly { key: string; href: string; icon: LucideIcon }[]

export type OrganizationSectionKey = (typeof ORGANIZATION_SECTIONS)[number]['key']

export interface OrganizationNavProps {
  sections: readonly OrganizationSectionKey[]
}

export function OrganizationNav({ sections }: OrganizationNavProps): JSX.Element {
  const t = useTranslations(organizationCopy)

  const items = ORGANIZATION_SECTIONS.filter((section) => sections.includes(section.key)).map(
    (section) => ({ ...section, label: t(`nav.${section.key}`) })
  )

  return (
    <SectionNav
      label={t('nav.label')}
      items={items}
      rootHref="/app/organization"
      pillId="org-nav-pill"
      data-testid="organization-nav"
    />
  )
}
