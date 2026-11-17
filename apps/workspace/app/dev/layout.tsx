import { notFound } from 'next/navigation'
import { type ReactNode } from 'react'

export default function DevLayout({ children }: { children: ReactNode }): ReactNode {
  if (process.env.NODE_ENV !== 'development') notFound()
  return children
}
