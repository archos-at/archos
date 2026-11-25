'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { FolderOpen, Library } from 'lucide-react'
import { listBaseKnowledge } from '@/adapters/api/base-knowledge-client'
import { SectionNav, type SectionNavItem } from '@/components/shell/section-nav'
import { useTranslations } from '@/i18n'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'

export const OFFICE_SHELF_FILES_HREF = '/app/office-shelf'
export const OFFICE_SHELF_NORMS_HREF = '/app/base-knowledge'

function useNormsToConfirm(): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    listBaseKnowledge({ limit: 1 }).then(
      (list) => live && setCount(list.counts.proposed),
      () => live && setCount(0)
    )
    return () => {
      live = false
    }
  }, [])
  return count
}

export function OfficeShelfPlaces({ pathname }: { pathname?: string }): JSX.Element {
  const t = useTranslations(officeShelfCopy)
  const toConfirm = useNormsToConfirm()
  const items: SectionNavItem[] = [
    { key: 'files', href: OFFICE_SHELF_FILES_HREF, icon: FolderOpen, label: t('places.files') },
    {
      key: 'norms',
      href: OFFICE_SHELF_NORMS_HREF,
      icon: Library,
      label: t('places.norms'),
      count: toConfirm,
      countLabel: toConfirm ? t('places.normsToConfirm', { count: toConfirm }) : undefined,
    },
  ]
  return (
    <SectionNav
      label={t('places.label')}
      items={items}
      rootHref={OFFICE_SHELF_FILES_HREF}
      pillId="office-shelf-places-pill"
      orientation="tabs"
      pathname={pathname}
      words
      data-testid="office-shelf-tabs"
    />
  )
}
