'use client'

import { sendMailArchive, type SendProgress } from '@/lib/mail-import/client'
import type { MailImportUploadPlan } from '@/lib/mail-import/types'

export interface MailImportSend {
  projectId: string
  importId: string
  filename: string
  sentBytes: number
  totalBytes: number
  phase: SendProgress['phase']
}

export interface MailImportSendFailure {
  projectId: string
  stage: 'start' | 'send'
  error: unknown
}

export interface MailImportSendState {
  send: MailImportSend | null
  failure: MailImportSendFailure | null
}

export class MailImportSendBusyError extends Error {
  constructor() {
    super('This tab is already sending an archive.')
    this.name = 'MailImportSendBusyError'
  }
}

export function isMailImportSending(): boolean {
  return controller !== null
}

const IDLE: MailImportSendState = { send: null, failure: null }

let state: MailImportSendState = IDLE
let controller: AbortController | null = null
const listeners = new Set<() => void>()

function set(next: MailImportSendState): void {
  state = next
  for (const listener of listeners) listener()
}

export function subscribeMailImportSend(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function mailImportSendSnapshot(): MailImportSendState {
  return state
}

export function mailImportSendServerSnapshot(): MailImportSendState {
  return IDLE
}

function warnBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}

export async function runMailImportSend(projectId: string, plan: MailImportUploadPlan, file: File): Promise<void> {
  if (controller) throw new MailImportSendBusyError()
  const abort = new AbortController()
  controller = abort
  rememberFile(plan.import.id, file)
  const base = { projectId, importId: plan.import.id, filename: file.name }
  set({ send: { ...base, sentBytes: 0, totalBytes: file.size, phase: 'sending' }, failure: null })
  window.addEventListener('beforeunload', warnBeforeUnload)
  let failure: MailImportSendFailure | null = null
  try {
    await sendMailArchive(projectId, plan, file, (progress) => set({ send: { ...base, ...progress }, failure: null }), abort.signal)
    forgetFile(plan.import.id)
  } catch (error) {
    if (!abort.signal.aborted) failure = { projectId, stage: 'send', error }
  } finally {
    window.removeEventListener('beforeunload', warnBeforeUnload)
    controller = null
    set({ send: null, failure })
  }
}

export function abortMailImportSend(importId: string): void {
  if (state.send?.importId === importId) controller?.abort()
}

export function failMailImportSend(projectId: string, error: unknown): void {
  set({ send: state.send, failure: { projectId, stage: 'start', error } })
}

export function clearMailImportSendFailure(): void {
  if (state.failure) set({ send: state.send, failure: null })
}

const FILE_KEY = 'mailImport.file.'

function fingerprint(file: File): string {
  return `${file.size}:${file.lastModified}`
}

function rememberFile(importId: string, file: File): void {
  try {
    window.localStorage.setItem(FILE_KEY + importId, fingerprint(file))
  } catch {
    // Storage blocked (a private window): resuming then checks name and size only.
  }
}

function forgetFile(importId: string): void {
  try {
    window.localStorage.removeItem(FILE_KEY + importId)
  } catch {
    // As above.
  }
}

export function isSameMailImportFile(importId: string, file: File): boolean {
  try {
    const known = window.localStorage.getItem(FILE_KEY + importId)
    return known === null || known === fingerprint(file)
  } catch {
    return true
  }
}
