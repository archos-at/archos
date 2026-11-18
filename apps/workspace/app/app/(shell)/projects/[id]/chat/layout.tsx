import type { JSX } from 'react'
import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'

interface ChatLayoutProps {
  children: React.ReactNode
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('sections.chat') }
}

export default function ChatLayout({ children }: ChatLayoutProps): JSX.Element {
  return <>{children}</>
}
