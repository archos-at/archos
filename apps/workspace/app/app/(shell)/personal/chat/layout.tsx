import type { JSX } from 'react'
import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { navCopy } from '@/i18n/namespaces/nav'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(navCopy)
  return { title: t('railModePersonal') }
}

export default function PersonalChatLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>
}
