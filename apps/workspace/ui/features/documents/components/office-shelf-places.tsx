'use client'

import type { JSX } from 'react'
import { FolderOpen, Library } from 'lucide-react'
import { SectionNav, type SectionNavItem } from '@/components/shell/section-nav'
import { useTranslations } from '@/i18n'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'

export const OFFICE_SHELF_FILES_HREF = '/app/office-shelf'
export const OFFICE_SHELF_NORMS_HREF = '/app/base-knowledge'

export function OfficeShelfPlaces({ pathname }: { pathname?: string }): JSX.Element {
  const t = useTranslations(officeShelfCopy)
  const items: SectionNavItem[] = [
    { key: 'files', href: OFFICE_SHELF_FILES_HREF, icon: FolderOpen, label: t('places.files') },
    { key: 'norms', href: OFFICE_SHELF_NORMS_HREF, icon: Library, label: t('places.norms') },
  ]
  return (
    <SectionNav
      label={t('places.label')}
      items={items}
      rootHref={OFFICE_SHELF_FILES_HREF}
      pillId="office-shelf-places-pill"
      orientation="tabs"
      pathname={pathname}
      track
      data-testid="office-shelf-tabs"
    />
  )
}
