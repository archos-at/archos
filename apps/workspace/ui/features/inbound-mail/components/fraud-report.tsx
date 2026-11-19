'use client'

import { useId, useState, type JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import type { InboundMailClient } from '../lib/client'
import { refusalOf, type RefusalCode } from '../lib/refusal'
import { mailToast } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export interface FraudReportProps {
  projectId: string
  mailId: string
  client: Pick<InboundMailClient, 'report'>
  name: string
  own: boolean
  onReported: (view: InboundMailView) => void
  onRefused: (code: RefusalCode) => void
}

export function FraudReport({ projectId, mailId, client, name, own, onReported, onRefused }: FraudReportProps): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const hintId = useId()
  const [open, setOpen] = useState(false)

  const report = async (): Promise<void> => {
    try {
      const result = await client.report(projectId, mailId)
      toast.success(result.warned > 0 ? t('toast.reported', { count: result.warned }) : t('toast.reportedNobody'), mailToast())
      onReported(result.mail)
    } catch (error) {
      const code = refusalOf(error)
      toast.error(t(`refusals.${code}`), mailToast())
      onRefused(code)
    }
  }

  return (
    <div className="col-start-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="fraud-report">
      <Button type="button" variant="secondary" size="sm" aria-haspopup="dialog" aria-describedby={hintId} onClick={() => setOpen(true)} data-testid="fraud-report-open">
        {t('impersonationWarning.report')}
      </Button>
      <span id={hintId} className="text-muted-foreground text-xs">
        {t('impersonationWarning.reportHint')}
      </span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="warning"
        icon={ShieldAlert}
        title={t('impersonationWarning.reportTitle')}
        description={
          <>
            <span className="block">{own ? t('impersonationWarning.reportTextOwn') : t('impersonationWarning.reportText', { name })}</span>
            <span className="mt-2 block">{t('impersonationWarning.reportWhat')}</span>
          </>
        }
        confirmLabel={t('impersonationWarning.reportConfirm')}
        cancelLabel={t('impersonationWarning.reportCancel')}
        confirmTestId="fraud-report-confirm"
        onConfirm={report}
      />
    </div>
  )
}
