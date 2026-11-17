import type { ReactNode } from 'react'
import type { DropInfo } from '@/features/documents/hooks/use-file-drag-drop'
import type { IntakeDecision, IntakeView } from '@/lib/project-intake/types'

export const SETUP_STEP_IDS = ['project', 'filing', 'reading', 'questions', 'profile'] as const
export type SetupStepId = (typeof SETUP_STEP_IDS)[number]

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === 'string' && (SETUP_STEP_IDS as readonly string[]).includes(value)
}

export interface SetupStepProps {
  view: IntakeView
  projectId: string
  busy: boolean
  canDecide: boolean
  canUpload: boolean
  uploading: boolean
  onDecide: (decisions: IntakeDecision[]) => Promise<boolean>
  onFiles: (files: File[], info?: DropInfo) => void
  onReread: () => void | Promise<void>
  onNext?: () => void
  onGoTo: (step: SetupStepId) => void
}

export interface SetupStepSummary {
  id: SetupStepId
  note?: string
  open: boolean
}

export interface SetupStepSlots {
  children?: ReactNode
}
