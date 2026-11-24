import type { TurnView } from '@/lib/turns/turn-fold'
import type { TurnDriver } from './turn-driver'

export interface DriverPool {
  get: (conversationId: string | undefined) => TurnDriver | undefined
  ensure: (conversationId: string, projectId: string | undefined) => TurnDriver
  reconcile: (state: PoolState) => void
  closeAll: () => void
}

export interface PoolState {
  currentId: string | undefined
  turns: Record<string, TurnView>
  previousTurns?: Record<string, TurnView>
  known: (conversationId: string) => boolean
  projectIdOf: (conversationId: string) => string | undefined
}

type CreateDriver = (conversationId: string, projectId: string | undefined) => TurnDriver

export const createDriverPool = (create: CreateDriver, onClosed: (conversationId: string) => void): DriverPool => {
  const drivers = new Map<string, TurnDriver>()

  const close = (conversationId: string): void => {
    const driver = drivers.get(conversationId)
    if (!driver) return
    drivers.delete(conversationId)
    driver.close()
    onClosed(conversationId)
  }

  const ensure = (conversationId: string, projectId: string | undefined): TurnDriver => {
    const known = drivers.get(conversationId)
    if (known && known.projectId === projectId) return known
    if (known) close(conversationId)
    const driver = create(conversationId, projectId)
    drivers.set(conversationId, driver)
    void driver.connect()
    return driver
  }

  return {
    get: (conversationId) => (conversationId ? drivers.get(conversationId) : undefined),
    ensure,
    reconcile: ({ currentId, turns, previousTurns = turns, known, projectIdOf }) => {
      const running = Object.values(turns).filter((view) => view.phase === 'running')
      for (const [conversationId, driver] of [...drivers]) {
        if (!known(conversationId)) {
          for (const view of Object.values(previousTurns)) {
            if (view.conversationId === conversationId && view.phase === 'running') driver.cancel(view.turnId)
          }
          close(conversationId)
        } else if (conversationId !== currentId && !driver.busy()) {
          close(conversationId)
        }
      }
      for (const view of running) {
        if (known(view.conversationId) && !drivers.has(view.conversationId)) {
          ensure(view.conversationId, projectIdOf(view.conversationId))
        }
      }
    },
    closeAll: () => {
      for (const conversationId of [...drivers.keys()]) close(conversationId)
    },
  }
}
