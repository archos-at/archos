'use client'

import type { JSX, ReactNode } from 'react'
import { NormDialogProvider } from '@/components/norms/norm-dialog-slot'
import { NormDialog } from '@/features/base-knowledge/components/norm-dialog'

export function ShellNormDialog({ children }: { children: ReactNode }): JSX.Element {
  return <NormDialogProvider dialog={NormDialog}>{children}</NormDialogProvider>
}
