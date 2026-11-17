import type { JSX } from 'react'
import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { InboxSheet } from './inbox-sheet'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(collaborationCopy)
  return { title: t('inbox.title') }
}

export default function InboxPage(): JSX.Element {
  return <InboxSheet standalone />
}
