'use client'

import { useCallback, useEffect, useState, type FC, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { LoadError } from '@/components/ui/load-error'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/format'
import { useLocale, useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'

interface StorageScopeUsage {
  bytes: number
  documents: number
}

interface StorageResponse {
  usage: {
    project: StorageScopeUsage
    office_shelf?: StorageScopeUsage
    archiv?: StorageScopeUsage
    total: StorageScopeUsage
  }
  quotaBytes: number | null
  effectiveMaxUploadFileBytes: number
}

const NEAR_QUOTA_RATIO = 0.9

const StorageMeter: FC<{ usedBytes: number; quotaBytes: number | null }> = ({
  usedBytes,
  quotaBytes,
}) => {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()

  const over = quotaBytes !== null && usedBytes >= quotaBytes
  const near = !over && quotaBytes !== null && usedBytes >= quotaBytes * NEAR_QUOTA_RATIO
  const scale = quotaBytes !== null ? Math.max(quotaBytes, usedBytes) : usedBytes
  const fillPct = scale > 0 ? Math.min((usedBytes / scale) * 100, 100) : 0
  const quotaPct = over && quotaBytes !== null && scale > 0 ? (quotaBytes / scale) * 100 : null

  const reading =
    quotaBytes !== null
      ? t('storage.ofQuota', {
          used: formatBytes(usedBytes, locale),
          quota: formatBytes(quotaBytes, locale),
        })
      : t('storage.noQuota', { used: formatBytes(usedBytes, locale) })

  return (
    <div className="storage-viz">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t('storage.used')}</p>
        <p className="text-muted-foreground text-right text-xs tabular-nums">{reading}</p>
      </div>
      <div
        className="bg-muted relative mt-1.5 h-2.5 w-full overflow-hidden rounded-[4px]"
        role="img"
        aria-label={`${t('storage.used')}: ${reading}`}
        data-testid={`storage-meter-${over ? 'over' : 'within'}`}
      >
        <div
          className="h-full rounded-r-[4px]"
          style={{
            width: `${fillPct}%`,
            backgroundColor: over ? 'var(--storage-meter-over)' : 'var(--storage-meter)',
          }}
        />
        {quotaPct !== null && (
          <span
            className="bg-foreground/60 absolute inset-y-0 w-px"
            style={{ left: `${quotaPct}%` }}
            aria-hidden
            data-testid="storage-quota-tick"
          />
        )}
      </div>
      {over && (
        <p className="text-destructive mt-1 flex items-center gap-1 text-sm">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {t('storage.overQuota')}
        </p>
      )}
      {near && <p className="text-muted-foreground mt-1 text-xs">{t('storage.nearQuota')}</p>}
    </div>
  )
}

const FactRow: FC<{ label: string; testId?: string; children: ReactNode }> = ({
  label,
  testId,
  children,
}) => (
  <div className="flex items-baseline justify-between gap-2 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="tabular-nums" data-testid={testId}>
      {children}
    </span>
  </div>
)

const ScopeRow: FC<{ label: string; usage: StorageScopeUsage }> = ({ label, usage }) => {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()

  return (
    <FactRow label={label}>
      {formatBytes(usage.bytes, locale)}
      <span className="text-muted-foreground ml-2 text-xs">
        {t('storage.documentCount', { count: String(usage.documents) })}
      </span>
    </FactRow>
  )
}

const STORAGE_ENDPOINT = '/api/organization/storage'

interface StorageUsageCardProps {
  endpoint?: string
}

export const StorageUsageCard: FC<StorageUsageCardProps> = ({
  endpoint = STORAGE_ENDPOINT,
}) => {
  const t = useTranslations(organizationCopy)
  const { locale } = useLocale()
  const [data, setData] = useState<StorageResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint)
      if (!res.ok) throw new Error('load failed')
      setData((await res.json()) as StorageResponse)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-[11.5rem] flex-col gap-6" data-testid="storage-usage-loading">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="mt-1.5 h-2.5 w-full rounded-[4px]" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>
    )
  }

  if (!data) {
    return (
      <LoadError
        title={t('storage.loadError')}
        onRetry={() => {
          setLoading(true)
          return load()
        }}
      />
    )
  }

  return (
    <div className="animate-in fade-in-0 flex min-h-[11.5rem] flex-col gap-6 duration-base ease-out motion-reduce:animate-none" data-testid="storage-usage">
      <StorageMeter usedBytes={data.usage.total.bytes} quotaBytes={data.quotaBytes} />

      <div className="flex flex-col gap-2">
        <ScopeRow label={t('storage.projectDocuments')} usage={data.usage.project} />
        <ScopeRow label={t('storage.officeShelfDocuments')} usage={data.usage.office_shelf ?? data.usage.archiv ?? { bytes: 0, documents: 0 }} />
        {/* The per-file limit, beside the quota because both refuse uploads and
            both belong to the platform: a member whose file was just refused
            for its size finds the number here. */}
        <FactRow label={t('storage.maxFileSize')} testId="storage-max-file-size">
          {formatBytes(data.effectiveMaxUploadFileBytes, locale)}
        </FactRow>
      </div>

      {/* Says who owns the number, so nobody hunts for a control that is not
          here. Shown even when unlimited — "no quota" is also a platform
          decision, not an absence of one. */}
      <p className="text-muted-foreground border-t pt-4 text-xs">{t('storage.setByPlatform')}</p>
    </div>
  )
}
