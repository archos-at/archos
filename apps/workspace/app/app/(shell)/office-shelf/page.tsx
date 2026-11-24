import type { JSX } from 'react'
import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { officeShelfCopy } from '@/i18n/namespaces/office-shelf'
import { OfficeShelfPageBody } from './office-shelf-page-body'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(officeShelfCopy)
  return { title: t('title') }
}

export default function OfficeShelfPage(): JSX.Element {
  return <OfficeShelfPageBody />
}
