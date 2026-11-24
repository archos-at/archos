'use client'

import type { JSX } from 'react'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { isAgentMentionId } from '@/lib/mentions/types'
import type { PersonPeekPerson } from '../components/PersonPeek'

export interface ResolvedMentionPerson {
  person: PersonPeekPerson
  isAgent: boolean
  isYou: boolean
  isParticipant?: boolean
}

interface MentionPeopleValue {
  resolve: (targetId: string) => ResolvedMentionPerson | null
}

const MentionPeopleContext = createContext<MentionPeopleValue | null>(null)

export interface MentionPeopleProviderProps {
  participants: readonly PersonPeekPerson[]
  currentUserId?: string | null
  agentName: string
  enabled?: boolean
  children: ReactNode
}

export function MentionPeopleProvider({
  participants,
  currentUserId,
  agentName,
  enabled = true,
  children,
}: MentionPeopleProviderProps): JSX.Element {
  const value = useMemo<MentionPeopleValue | null>(() => {
    if (!enabled) return null

    const byId = new Map(participants.map((person) => [person.userId, person]))
    return {
      resolve: (targetId) => {
        if (isAgentMentionId(targetId)) {
          return {
            person: { userId: targetId, name: agentName },
            isAgent: true,
            isYou: false,
          }
        }

        const person = byId.get(targetId)
        if (!person) return null

        return {
          person,
          isAgent: false,
          isYou: Boolean(currentUserId) && targetId === currentUserId,
          isParticipant: true,
        }
      },
    }
  }, [enabled, participants, currentUserId, agentName])

  return <MentionPeopleContext.Provider value={value}>{children}</MentionPeopleContext.Provider>
}

export function useMentionPerson(targetId: string): ResolvedMentionPerson | null {
  const context = useContext(MentionPeopleContext)
  return context ? context.resolve(targetId) : null
}
