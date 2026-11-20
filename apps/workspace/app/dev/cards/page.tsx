'use client'

import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { useFakeProposalClient } from '../_fixtures/fake-proposals'
import { AnswerCardSections } from './answer-cards-sections'
import { SchematicCardSections } from './schematic-cards-sections'
import { TextCardSections } from './text-cards-sections'

export default function CardsGalleryPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Gallery />
    </I18nProvider>
  )
}

function Gallery() {
  const proposalsReady = useFakeProposalClient()
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <h1 className="text-lg font-semibold">Grid card gallery</h1>

      <TextCardSections />
      <SchematicCardSections />
      <AnswerCardSections proposalsReady={proposalsReady} />
    </main>
  )
}
