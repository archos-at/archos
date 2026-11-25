import 'server-only'
import { cookies } from 'next/headers'
import { arrivalResumes, chatResumeCookie } from '@/features/chat/lib/resume-cookie'

export async function chatArrivalResumes(
  side: string | null,
  search: { session?: string | null; new?: string | null }
): Promise<boolean> {
  const name = chatResumeCookie(side)
  const sideCookieSet = name !== null && (await cookies()).has(name)
  return arrivalResumes(search, sideCookieSet)
}
