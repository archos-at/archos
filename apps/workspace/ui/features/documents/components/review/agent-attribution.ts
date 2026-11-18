import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { PRODUCT_NAME } from '@/lib/brand'

export function useAgentByline(): (forName: string | null | undefined, options?: { proposal?: boolean }) => string {
  const t = useTranslations(filesCopy)
  return (forName, options) => {
    const name = forName?.trim()
    if (!name) return PRODUCT_NAME
    return options?.proposal ? t('review.attribution.proposalFor', { name }) : t('review.attribution.agentFor', { name })
  }
}
