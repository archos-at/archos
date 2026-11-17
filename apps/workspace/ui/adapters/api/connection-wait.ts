import type { TurnSocketStatus } from './turn-socket-machine'

export const CONNECTION_WAIT_NOTE_AFTER_MS = 2_000

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
