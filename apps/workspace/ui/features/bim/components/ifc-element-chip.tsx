'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { Box } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimElementLink } from '../lib/element-question'
import { elementLinkHref } from '../lib/element-question'

export interface IfcElementChipProps {
  link: BimElementLink
  children: ReactNode
}

export function IfcElementChip({ link, children }: IfcElementChipProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const view = link.view
  const target = view.element
    ? t('card.openElement')
    : view.storey
      ? t('card.openStorey', { name: view.storey })
      : t('card.openModel')

  return (
    <Link
      href={elementLinkHref(link)}
      title={target}
      className="mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-md border border-transparent bg-info-subtle px-1.5 py-0.5 align-baseline text-[0.9em] text-info no-underline transition-opacity duration-snap ease-out hover:opacity-80"
    >
      <Box className="size-3 shrink-0 self-center" aria-hidden="true" />
      <span className="truncate">{children}</span>
      <span className="sr-only"> — {target}</span>
    </Link>
  )
}
