'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

export function OrgReingestFailedCard(): JSX.Element {
  const t = useTranslations(organizationCopy)
  const [isRescanning, setIsRescanning] = useState(false)

  const handleRescan = async (): Promise<void> => {
    setIsRescanning(true)
    try {
      const response = await fetch('/api/organization/documents/reingest-failed', {
        method: 'POST',
      })
      if (!response.ok) throw new Error(String(response.status))
      toast.success(t('advanced.reingestFailed.started'))
    } catch {
      toast.error(t('advanced.reingestFailed.failed'))
    } finally {
      setIsRescanning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('advanced.reingestFailed.title')}</CardTitle>
        <CardDescription>{t('advanced.reingestFailed.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="secondary" onClick={handleRescan} disabled={isRescanning}>
          <RefreshCw
            className={isRescanning ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'}
            aria-hidden="true"
          />
          {isRescanning ? t('advanced.reingestFailed.busy') : t('advanced.reingestFailed.action')}
        </Button>
      </CardContent>
    </Card>
  )
}
