import type { ReactNode } from 'react'
import { ChatFirstPaintPreview } from './preview'

export default async function ChatFirstPaintPage({
  searchParams,
}: {
  searchParams: Promise<{ resumes?: string }>
}): Promise<ReactNode> {
  const { resumes } = await searchParams
  return <ChatFirstPaintPreview arrival={{ resumes: resumes === '1', greetingName: 'Anna Berger' }} />
}
