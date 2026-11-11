/**
 * Whether a turn socket has been without a connection for more than a moment.
 *
 * What a person waits on is "not connected while my answer is running", not
 * the machine's word for it. `reconnecting` is the ladder; `connecting` is an
 * attempt, and after the page comes back from being hidden it is the only
 * word a slow first dial ever says. Both count, across the attempts, until a
 * status that has its own meaning ends the wait: `open` (connected), `closed`
 * (the caller's), `suspended` (a hidden tab nobody reads), `offline` and
 * `failed` (the connection-lost line), `incompatible` and `outdated` (their
 * own cards).
 *
 * Store-free and clock-only, so the chat and the review canvas say the same
 * thing after the same wait.
 */

import type { TurnSocketStatus } from './turn-socket-machine'

/**
 * How long the socket may be unconnected before anyone is told. The ladder's
 * first rung is a second, and a first connect on a normal page load opens
 * well inside this: a drop that the first attempt mends (a pod replaced, a
 * proxy that reset) is over before anyone could read a line.
 */
export const CONNECTION_WAIT_NOTE_AFTER_MS = 2_000

/** `onStatus`, with `onWaiting(true)` once the wait is long and `onWaiting(false)` when it ends. */
export const watchConnectionWait = (
  onWaiting: (waiting: boolean) => void,
  onStatus: (status: TurnSocketStatus) => void
): ((status: TurnSocketStatus) => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let told = false
  const tell = (waiting: boolean): void => {
    if (told === waiting) return
    told = waiting
    onWaiting(waiting)
  }
  return (status) => {
    if (status === 'connecting' || status === 'reconnecting') {
      timer ??= setTimeout(() => tell(true), CONNECTION_WAIT_NOTE_AFTER_MS)
    } else {
      if (timer) clearTimeout(timer)
      timer = null
      tell(false)
    }
    onStatus(status)
  }
}
