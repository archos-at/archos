import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import { PRODUCT_NAME } from '@/lib/brand'

export const AGENT_CANDIDATE = {
  targetId: AGENT_MENTION_ID,
  person: { userId: AGENT_MENTION_ID, name: PRODUCT_NAME, email: null, profilePictureUrl: null },
  isAgent: true,
  isParticipant: true,
  needsInvite: false,
}
export const ANNA_CANDIDATE = {
  targetId: 'u-anna',
  person: {
    userId: 'u-anna',
    name: 'Anna Weber',
    email: 'anna@example.com',
    profilePictureUrl: null,
  },
  isAgent: false,
  isParticipant: true,
  needsInvite: false,
}
export const MARKUS_CANDIDATE = {
  targetId: 'u-markus',
  person: {
    userId: 'u-markus',
    name: 'Markus Hofer',
    email: 'markus@example.com',
    profilePictureUrl: null,
  },
  isAgent: false,
  isParticipant: true,
  needsInvite: false,
}
