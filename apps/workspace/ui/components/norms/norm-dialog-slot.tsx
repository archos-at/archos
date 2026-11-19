'use client'

import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import type { NormRecognition, SettleProposalsBody } from '@/lib/base-knowledge/wire'

export interface NormDialogDestination {
  description: string
  laterNotice: string
  notNorm: boolean
  choice?: ReactNode
  confirm: (rows: SettleProposalsBody['rows']) => Promise<void>
}

export interface NormDialogSlotProps {
  recognition: NormRecognition | null
  onClose: () => void
  onSettled: () => void
  destination: NormDialogDestination
}

const NormDialogSlot = createContext<ComponentType<NormDialogSlotProps> | null>(null)

export function NormDialogProvider({ dialog, children }: { dialog: ComponentType<NormDialogSlotProps>; children: ReactNode }) {
  return <NormDialogSlot.Provider value={dialog}>{children}</NormDialogSlot.Provider>
}

export function useNormDialog(): ComponentType<NormDialogSlotProps> | null {
  return useContext(NormDialogSlot)
}
