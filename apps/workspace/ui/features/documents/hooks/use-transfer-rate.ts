'use client'

import { useEffect, useRef, useState } from 'react'
import { TransferRateEstimator } from '../lib/upload-progress'

const TICK_MS = 1_000

export interface TransferRate {
  bytesPerSecond: number | null
  etaSeconds: number | null
}

export function useTransferRate(
  uploadedBytes: number,
  remainingBytes: number,
  active: boolean,
  windowMs?: number
): TransferRate {
  const estimatorRef = useRef<TransferRateEstimator | null>(null)
  estimatorRef.current ??= new TransferRateEstimator(windowMs)
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (!active) {
      estimatorRef.current?.reset()
      return
    }
    estimatorRef.current?.sample(uploadedBytes, Date.now())
  }, [uploadedBytes, active])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => forceTick((n) => n + 1), TICK_MS)
    return () => clearInterval(timer)
  }, [active])

  const estimator = estimatorRef.current
  if (!active || !estimator) return { bytesPerSecond: null, etaSeconds: null }
  return {
    bytesPerSecond: estimator.bytesPerSecond(),
    etaSeconds: estimator.etaSeconds(remainingBytes),
  }
}

export function useElapsedSeconds(startedAt: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || startedAt === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [active, startedAt])

  if (startedAt === null) return 0
  return Math.max(0, (now - startedAt) / 1000)
}
