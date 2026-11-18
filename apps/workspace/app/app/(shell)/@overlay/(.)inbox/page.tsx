import type { JSX } from 'react'
import { InboxSheet } from '../../inbox/inbox-sheet'

export default function InboxOverlayPage(): JSX.Element {
  return <InboxSheet standalone={false} />
}
