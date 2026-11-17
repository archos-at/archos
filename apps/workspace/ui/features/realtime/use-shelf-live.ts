'use client'

import { useLiveHints, type LiveHintOptions } from './use-live-hints'
import { shelfChannelKey, shelfEventSchema, type LiveShelf, type ShelfEvent } from '@/lib/documents/shelf-live-events'

export interface ShelfChange {
  folders: boolean
}

export type ShelfLiveOptions = Pick<
  LiveHintOptions<ShelfEvent, ShelfChange>,
  'enabled' | 'link' | 'coalesceMs' | 'jitterMs' | 'holdWhile' | 'holdMs'
>

const parseShelfEvent = (event: unknown): ShelfEvent | null => {
  const parsed = shelfEventSchema.safeParse(event)
  return parsed.success ? parsed.data : null
}

const foldShelfEvent = (gathered: ShelfChange | null, event: ShelfEvent): ShelfChange => ({
  folders: (gathered?.folders ?? false) || event.folders,
})

const SHELF_RESYNC: ShelfChange = { folders: true }

export function useShelfLive(
  shelf: LiveShelf | null,
  onChange: (change: ShelfChange) => void,
  options: ShelfLiveOptions = {}
): void {
  useLiveHints(shelf ? shelfChannelKey(shelf) : null, {
    parse: parseShelfEvent,
    fold: foldShelfEvent,
    resync: SHELF_RESYNC,
    onChange,
    ...options,
  })
}
