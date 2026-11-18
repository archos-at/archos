'use client'

import { type FC, useState } from 'react'
import { ExternalLink, ScrollText } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

interface AuditLogButtonProps {
  endpoint: string
  label: string
  errorMessage: string
}

export const AuditLogButton: FC<AuditLogButtonProps> = ({ endpoint, label, errorMessage }) => {
  const [loading, setLoading] = useState(false)
  const showBusy = useDelayedFlag(loading)

  const open = async (): Promise<void> => {
    setLoading(true)
    const tab = window.open('', '_blank')
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      const { link } = (await res.json()) as { link: string }
      if (tab) {
        tab.location.href = link
      } else {
        window.location.assign(link)
      }
    } catch {
      tab?.close()
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        if (!loading) void open()
      }}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      className="aria-disabled:cursor-default"
    >
      {showBusy ? (
        <Spinner size="xs" className="mr-1.5" />
      ) : (
        <ScrollText className="mr-1.5 size-3.5" aria-hidden />
      )}
      {label}
      <ExternalLink className="ml-1.5 size-3 text-muted-foreground" aria-hidden />
    </Button>
  )
}
