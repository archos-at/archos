'use client'

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

const SPLIT_MIN_WIDTH = 768

export function useOpenFirstMail({
  mailId,
  firstId,
  scope,
  open,
}: {
  mailId: string | null
  scope: string
  firstId: string | null
  open: (mailId: string) => void
}): { ref: RefObject<HTMLDivElement | null>; pending: boolean } {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pending, setPending] = useState(false)
  const opened = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (mailId !== null || firstId === null || opened.current === scope) return
    if ((ref.current?.getBoundingClientRect().width ?? 0) < SPLIT_MIN_WIDTH) return
    opened.current = scope
    setPending(true)
    open(firstId)
  }, [mailId, firstId, scope, open])
  return { ref, pending: pending && mailId === null }
}
