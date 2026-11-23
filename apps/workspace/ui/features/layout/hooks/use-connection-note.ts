import { useEffect, useState } from 'react'
import { RECONNECTED_NOTE_MS } from '../components/chat-area/chat-area-helpers'

export function useConnectionNote(conversationId: string | undefined, connectionLost: boolean) {
  const [connectionNote, setConnectionNote] = useState<'lost' | 'restored' | null>(
    connectionLost ? 'lost' : null
  )
  const [connectionSeen, setConnectionSeen] = useState({
    conversationId,
    lost: connectionLost,
  })
  if (connectionSeen.conversationId !== conversationId) {
    setConnectionSeen({ conversationId, lost: connectionLost })
    setConnectionNote(connectionLost ? 'lost' : null)
  } else if (connectionSeen.lost !== connectionLost) {
    setConnectionSeen({ conversationId, lost: connectionLost })
    setConnectionNote(connectionLost ? 'lost' : 'restored')
  }
  useEffect(() => {
    if (connectionNote !== 'restored') return
    const timer = setTimeout(() => setConnectionNote(null), RECONNECTED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [connectionNote])
  return connectionNote
}
