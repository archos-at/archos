/**
 * Platform → Länder → one country: everything about its knowledge in one place.
 *
 * Owner gate, shell chrome and section nav live in the shared `layout.tsx`;
 * this page only checks the code is a country's and renders the country.
 */

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { CountryPage } from '@/features/platform/components/countries/country-page'

export default async function PlatformCountryPage({ params }: { params: Promise<{ countryId: string }> }): Promise<JSX.Element> {
  const { countryId } = await params
  if (!/^[A-Za-z]{2}$/.test(countryId)) notFound()
  return <CountryPage countryId={countryId.toUpperCase()} />
}
