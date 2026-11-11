'use client'

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * The split view's width: the list beside the reader from a 48rem box (`@3xl`
 * in `InboundMailWorkspace`). Narrower, an open mail is a page of its own and
 * the list is the place to arrive at.
 */
const SPLIT_MIN_WIDTH = 768

/**
 * Open the first mail of the list when the E-Mail-Eingang is reached with none
 * open and there is room for the reader beside the list (paper on a desk: a
 * reader is a sheet, never an empty white field two thirds of a desk wide).
 *
 * A replace, not a push: arriving opened nothing the reader asked for, so Back
 * leaves the E-Mail-Eingang instead of stepping from the first mail to an
 * empty pane. Never on a phone or a narrow window, where opening a mail hides
 * the list; never while the list is still being read. `pending` is true from
 * the decision to the navigation, so the pane draws nothing rather than „Wählen
 * Sie eine E-Mail …“ for the moment before the mail arrives.
 */
export function useOpenFirstMail({
  mailId,
  firstId,
  scope,
  open,
}: {
  mailId: string | null
  /** The list's filter: arriving at another list (Wartet, Bearbeitet) opens its first mail once more. */
  scope: string
  /** The list's first visible mail, null while the list loads or is empty. */
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
