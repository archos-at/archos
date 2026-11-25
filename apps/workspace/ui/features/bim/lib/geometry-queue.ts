let tail: Promise<void> = Promise.resolve()

export function abortError(): DOMException {
  return new DOMException('The geometry build was stopped before it started.', 'AbortError')
}

export function runExclusive<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  const previous = tail
  let done!: () => void
  tail = new Promise<void>((resolve) => {
    done = resolve
  })
  const waitForTurn = new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    void previous.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
  return waitForTurn.then(task).finally(() => {
    void previous.then(done)
  })
}
