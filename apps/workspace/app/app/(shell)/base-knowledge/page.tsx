/**
 * Grundlagen des Büros, the hard-load arrival of its sheet (ADR-0024): a
 * refresh or a pasted link, where there is no page underneath to cover.
 */

import type { JSX } from 'react'
import { type Metadata } from 'next'
import { getTranslations } from '@/i18n/server'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { BaseKnowledgeSheet } from './base-knowledge-sheet'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(baseKnowledgeCopy)
  return { title: t('title') }
}

export default function BaseKnowledgePage(): JSX.Element {
  return <BaseKnowledgeSheet standalone />
}
