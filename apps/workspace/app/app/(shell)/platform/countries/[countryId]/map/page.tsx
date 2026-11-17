/**
 * Platform → a country → law map: the country's regions, the acts that make
 * editions binding in each, and what each act says (`LawMapPage`).
 */

import type { JSX } from 'react'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { LawMapPage } from '@/features/platform/components/law-map/law-map-page'

export default async function PlatformLawMapPage({ params }: { params: Promise<{ countryId: string }> }): Promise<JSX.Element> {
  const { countryId } = await params
  if (!/^[A-Za-z]{2}$/.test(countryId)) notFound()
  return (
    <Suspense>
      <LawMapPage countryId={countryId.toUpperCase()} />
    </Suspense>
  )
}
