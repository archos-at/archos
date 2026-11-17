import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { CountryPage } from '@/features/platform/components/countries/country-page'

export default async function PlatformCountryPage({ params }: { params: Promise<{ countryId: string }> }): Promise<JSX.Element> {
  const { countryId } = await params
  if (!/^[A-Za-z]{2}$/.test(countryId)) notFound()
  return <CountryPage countryId={countryId.toUpperCase()} />
}
