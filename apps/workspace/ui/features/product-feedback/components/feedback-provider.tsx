'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { fetchOwnFeedback } from '@/lib/product-feedback/client'
import { FEEDBACK_THREAD_PARAM, type OwnProductFeedbackListResponse, type ProductFeedbackKind } from '@/lib/product-feedback/types'
import { FeedbackThreadsDialog, type FeedbackThreadsApi } from './feedback-threads'

export const UPDATES_REFRESH_MS = 5 * 60 * 1000

type OpenFeedback = (kind?: ProductFeedbackKind) => void
type OpenFeedbackThreads = (reportId?: string) => void

interface FeedbackContextValue {
  openFeedback: OpenFeedback
  openThreads: OpenFeedbackThreads
  updatedCount: number
}

const FeedbackContext = React.createContext<FeedbackContextValue | null>(null)

const noop = (): void => undefined

export function useOpenFeedback(): OpenFeedback {
  return React.useContext(FeedbackContext)?.openFeedback ?? noop
}

export function useOpenFeedbackThreads(): OpenFeedbackThreads {
  return React.useContext(FeedbackContext)?.openThreads ?? noop
}

export function useFeedbackUpdatedCount(): number {
  return React.useContext(FeedbackContext)?.updatedCount ?? 0
}

export function useFeedbackAvailable(): boolean {
  return React.useContext(FeedbackContext) !== null
}

function useUpdatedCount(
  list: () => Promise<OwnProductFeedbackListResponse>
): { count: number; remember: (count: number) => void; refresh: () => void } {
  const [count, setCount] = React.useState(0)
  const lastRead = React.useRef(0)
  const alive = React.useRef(true)

  const remember = React.useCallback((next: number) => {
    lastRead.current = Date.now()
    setCount(next)
  }, [])

  const refresh = React.useCallback(() => {
    lastRead.current = Date.now()
    list()
      .then((page) => {
        if (alive.current) setCount(page.updatedCount)
      })
      .catch(() => undefined)
  }, [list])

  React.useEffect(() => {
    alive.current = true
    const onFocus = (): void => {
      if (Date.now() - lastRead.current >= UPDATES_REFRESH_MS) refresh()
    }
    refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  return { count, remember, refresh }
}

function ThreadFromAddress({ onThread }: { onThread: (reportId: string) => void }): null {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const reportId = params?.get(FEEDBACK_THREAD_PARAM) ?? null

  React.useEffect(() => {
    if (!reportId) return
    onThread(reportId)
    const rest = new URLSearchParams(params?.toString() ?? '')
    rest.delete(FEEDBACK_THREAD_PARAM)
    const query = rest.toString()
    router.replace(`${pathname ?? '/app/projects'}${query ? `?${query}` : ''}`, { scroll: false })
  }, [reportId, onThread, params, pathname, router])

  return null
}

interface Start {
  compose: ProductFeedbackKind | null
  reportId: string | null
}

export function FeedbackProvider({
  userEmail = null,
  threadsApi,
  children,
}: {
  userEmail?: string | null
  threadsApi?: FeedbackThreadsApi
  children: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [start, setStart] = React.useState<Start>({ compose: null, reportId: null })
  const startAt = React.useCallback((next: Start) => {
    setStart((current) => (current.compose === next.compose && current.reportId === next.reportId ? current : next))
    setOpen(true)
  }, [])
  const list = threadsApi?.list ?? fetchOwnFeedback
  const { count: updatedCount, remember: setUpdatedCount, refresh: refreshUpdatedCount } = useUpdatedCount(list)

  const openFeedback = React.useCallback<OpenFeedback>(
    (kind) => startAt({ compose: kind ?? 'bug', reportId: null }),
    [startAt]
  )

  const openThreads = React.useCallback<OpenFeedbackThreads>(
    (reportId) => startAt({ compose: null, reportId: reportId ?? null }),
    [startAt]
  )

  const value = React.useMemo(
    () => ({ openFeedback, openThreads, updatedCount }),
    [openFeedback, openThreads, updatedCount]
  )

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <React.Suspense fallback={null}>
        <ThreadFromAddress onThread={openThreads} />
      </React.Suspense>
      <FeedbackThreadsDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) refreshUpdatedCount()
        }}
        initialCompose={start.compose}
        initialReportId={start.reportId}
        userEmail={userEmail}
        api={threadsApi}
        onUpdatedCount={setUpdatedCount}
      />
    </FeedbackContext.Provider>
  )
}
