import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

const slice = new AsyncLocalStorage<true>()

export function runAsJobSlice<T>(fn: () => Promise<T>): Promise<T> {
  return slice.run(true, fn)
}

export function inJobSlice(): boolean {
  return slice.getStore() === true
}
