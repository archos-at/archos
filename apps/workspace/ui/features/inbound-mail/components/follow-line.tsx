'use client'

import type { JSX } from 'react'
import { FollowSwitch } from '@/features/documents'

/** What filing the text starts for its Verlauf, as the same switch the Verlauf's „E-Mails“ tab shows. */
export function FollowLine({ follow, onFollow }: { follow: boolean; onFollow: (follow: boolean) => void }): JSX.Element {
  return <FollowSwitch on={follow} onChange={onFollow} className="border-edge mt-2 rounded-control border px-3 py-2.5" testId="filing-follow" />
}
