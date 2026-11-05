import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { StatusDrawing } from '@/components/brand/status-drawing'
import { StatusScreen } from '@/components/brand/status-screen'
import { getTranslations } from '@/i18n/server'
import { errorsCopy } from '@/i18n/namespaces/errors'

export default async function NotFound() {
  const t = await getTranslations(errorsCopy)
  return (
    <StatusScreen
      // A door that opens onto a room that was never built.
      art={<StatusDrawing kind="missing" className="w-72 sm:w-96" />}
      code={t('notFound.code')}
      title={t('notFound.title')}
      description={t('notFound.description')}
      actions={
        <Button asChild>
          <Link href="/app/projects">{t('notFound.action')}</Link>
        </Button>
      }
    />
  )
}
