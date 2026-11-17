/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { legacyHeaderName } from '@/lib/http/legacy-header-names'
import { deleteAnnotation, type AnnotationFetch } from './client'
import { ROOM_PEER_HEADER, roomPeerOf } from './peer-header'

const PEER = 'peer-abc12345'

const requestWith = (headers: Record<string, string>) => new Request('http://localhost/api/documents/d/annotations', { headers })

describe('the room peer header', () => {
  it('is sent under the name without the product', () => {
    expect(ROOM_PEER_HEADER).toBe('x-room-peer')
  })

  it('is read under the new name', () => {
    expect(roomPeerOf(requestWith({ 'x-room-peer': PEER }))).toBe(PEER)
  })

  it('is still read under the name it had before', () => {
    expect(roomPeerOf(requestWith({ [legacyHeaderName(ROOM_PEER_HEADER)]: PEER }))).toBe(PEER)
  })

  it('prefers the new name when both arrive', () => {
    expect(roomPeerOf(requestWith({ 'x-room-peer': PEER, [legacyHeaderName(ROOM_PEER_HEADER)]: 'peer-other999' }))).toBe(PEER)
  })

  it('refuses a value that is not a peer id', () => {
    expect(roomPeerOf(requestWith({ 'x-room-peer': 'no' }))).toBeNull()
    expect(roomPeerOf(requestWith({}))).toBeNull()
  })

  it('is sent by the annotation client under the new name', async () => {
    let sent: RequestInit | undefined
    const run: AnnotationFetch = async (_path, init) => {
      sent = init
      return new Response(null, { status: 204 })
    }

    await deleteAnnotation('doc-1', 'ann-1', { peerId: PEER, run })

    expect((sent?.headers as Record<string, string>)['x-room-peer']).toBe(PEER)
  })
})
