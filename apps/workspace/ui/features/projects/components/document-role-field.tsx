'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Camera, CheckCircle2, FileText, Loader2, Paperclip, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { projectsCopy } from '@/i18n/namespaces/projects'
import { loadUploadScreeningPolicy } from '@/adapters/api/upload-screening-policy'
import { screenUploadName, type NameMatch } from '@/lib/upload-screening/name-screen'
import { describeScreenedOut } from '@/lib/upload-screening/quarantine'
import { nameStopMatchesOf } from '@/lib/upload-screening/name-stop'
import type { UploadScreeningPolicy } from '@/lib/upload-screening/policy'
import { exclusionsByTerm, openUploadBatch, sealUploadBatch } from '@/features/documents/lib/upload-batch'
import { useFileDragDrop } from '@/features/documents/hooks/use-file-drag-drop'
import {
  bindDocumentRole,
  DocumentRoleRequestError,
  unbindDocumentRole,
  type RoleBinding,
} from '@/adapters/api/document-roles-client'
import { ApiRequestError } from '@/adapters/api/api-error'
import { documentRoleDefinition } from '@/lib/project-profile/document-roles'
import type { DocumentRole } from '@/lib/project-profile/document-roles'
import { useDocumentRoles } from '../lib/use-document-roles'
import type { PendingRoleBind } from '../lib/pending-role-binds'

interface DocumentRoleFieldProps {
  projectId: string
  role: DocumentRole
  scopeInstanceId?: string | null
  label?: string
  deferred?: {
    pending: readonly PendingRoleBind[]
    onDefer: (documentId: string, filename: string) => void
    onDiscard: (bind: PendingRoleBind) => void
    track: (work: Promise<unknown>) => void
  }
}

function documentLabel(binding: { displayName?: string | null; filename: string }): string {
  return binding.displayName?.trim() || binding.filename
}

export function DocumentRoleField({
  projectId,
  role,
  scopeInstanceId = null,
  label,
  deferred,
}: DocumentRoleFieldProps) {
  const definition = documentRoleDefinition(role)
  const tFiles = useTranslations(filesCopy)
  const tRole = useTranslations(projectsCopy, 'intake.documentRole')
  const { bindings, documents, refresh } = useDocumentRoles(projectId)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const mine = useMemo(
    () =>
      (bindings ?? []).filter(
        (binding) => binding.role === role && (binding.scopeInstanceId ?? null) === scopeInstanceId
      ),
    [bindings, role, scopeInstanceId]
  )

  const run = useCallback(
    (action: Promise<void>) => {
      void action.catch(() => toast.error(tRole('actionFailed')))
    },
    [tRole]
  )

  const bind = useCallback(
    async (documentId: string, filename?: string) => {
      if (deferred) {
        const known = documents.find((document) => document.id === documentId)
        deferred.onDefer(
          documentId,
          filename ?? (known ? documentLabel({ displayName: known.displayName ?? null, filename: known.filename }) : documentId)
        )
        await refresh({ afterWrite: true })
        return
      }
      setBusy(true)
      try {
        let replaced: RoleBinding[]
        try {
          ;({ replaced } = await bindDocumentRole(projectId, { documentId, role, scopeInstanceId }))
        } catch (error) {
          if (!(error instanceof DocumentRoleRequestError)) throw error
          console.warn('[document-role] binding refused:', error.status, error.body)
          toast.error(tRole('bindFailed'))
          await refresh({ afterWrite: true })
          return
        }
        for (const previous of replaced) {
          toast.info(tRole('replaced', { name: documentLabel(previous), role: definition.label }))
        }
        await refresh({ afterWrite: true })
      } finally {
        setBusy(false)
      }
    },
    [definition.label, deferred, documents, projectId, refresh, role, scopeInstanceId, tRole]
  )

  const unbind = useCallback(
    async (bindingId: string) => {
      setBusy(true)
      try {
        try {
          await unbindDocumentRole(projectId, bindingId)
        } catch (error) {
          if (!(error instanceof ApiRequestError)) throw error
          toast.error(tRole('unbindFailed'))
          return
        }
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [projectId, refresh, tRole]
  )

  const uploadAndBind = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setBusy(true)
      try {
        let policy: UploadScreeningPolicy
        try {
          policy = await loadUploadScreeningPolicy()
        } catch {
          toast.error(tFiles('errors.screeningPolicyUnavailable'))
          return
        }
        const screenedOut: Array<{ file: File; matches: NameMatch[] }> = []
        const allowed = list.filter((file) => {
          const verdict = screenUploadName(policy, { filename: file.name })
          if (verdict.blocked) screenedOut.push({ file, matches: verdict.matches })
          return !verdict.blocked
        })
        const batchId =
          allowed.length > 0
            ? await openUploadBatch({
                id: uuidv4(),
                scope: 'project',
                projectId,
                conversationId: null,
                expectedCount: allowed.length,
                excluded: exclusionsByTerm(screenedOut.map(({ matches }) => matches)),
              })
            : null
        let unchanged = 0
        let failed = 0
        const serverStopped: Array<{ file: File; matches: NameMatch[] }> = []
        let answered = 0
        try {
          for (const file of allowed) {
            const form = new FormData()
            form.append('file', file)
            form.append('projectId', projectId)
            if (batchId) form.append('uploadBatchId', batchId)
            const response = await fetch('/api/documents/upload', { method: 'POST', body: form })
            answered += 1
            if (!response.ok) {
              const matches = nameStopMatchesOf(await response.json().catch(() => null))
              if (matches) {
                serverStopped.push({ file, matches })
                continue
              }
              failed += 1
              toast.error(tRole('uploadFailed', { name: file.name }))
              continue
            }
            const body = (await response.json()) as { documentId?: string; unchanged?: boolean }
            if (body.unchanged) unchanged += 1
            const documentId = body.documentId
            if (!documentId) {
              toast.error(tRole('uploadedUnbound', { name: file.name }))
              continue
            }
            await bind(documentId, file.name)
          }
        } finally {
          const excluded = exclusionsByTerm(serverStopped.map(({ matches }) => matches))
          if (batchId) {
            await sealUploadBatch(batchId, {
              unchanged,
              failed: failed + allowed.length - answered,
              ...(excluded.length > 0 ? { excluded } : {}),
            })
          }
        }
        const screenedMessage = describeScreenedOut([...screenedOut, ...serverStopped], tFiles)
        if (screenedMessage) toast.error(screenedMessage)
      } finally {
        setBusy(false)
      }
    },
    [bind, projectId, tFiles, tRole]
  )

  const upload = useCallback(
    (files: FileList | File[]) => {
      const work = uploadAndBind(files)
      deferred?.track(work)
      run(work)
    },
    [deferred, run, uploadAndBind]
  )

  const takeDrop = useCallback(
    (dropped: File[]) => {
      if (dropped.length === 0) return
      if (definition.cardinality !== 'one' || dropped.length === 1) {
        upload(dropped)
        return
      }
      toast.info(tRole('dropOnlyOne', { name: dropped[0].name }))
      upload([dropped[0]])
    },
    [definition.cardinality, tRole, upload]
  )
  const { isDragging, refusal, dragHandlers } = useFileDragDrop({
    onDrop: (dropped) => takeDrop(dropped),
    refusal: busy ? tRole('dropBusy') : null,
  })

  const held = (deferred?.pending ?? []).filter(
    (bind) => bind.role === role && bind.scopeInstanceId === scopeInstanceId
  )
  const alreadyBound = new Set([
    ...mine.map((binding) => binding.documentId),
    ...held.map((bind) => bind.documentId),
  ])
  const selectable = documents.filter((document) => !alreadyBound.has(document.id))
  const full = definition.cardinality === 'one' && mine.length + held.length > 0

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-sm font-medium">{label}</span>}
      {definition.why && <p className="text-muted-foreground text-xs">{definition.why}</p>}

      {bindings === null ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {tRole('loading')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={tRole('boundAria', { role: definition.label })}>
          {mine.map((binding) => (
            <li
              key={binding.id}
              className="bg-muted/20 flex items-center gap-2 rounded-control border px-3 py-2 text-sm"
            >
              <CheckCircle2 className="text-primary size-4 shrink-0" aria-hidden />
              <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{documentLabel(binding)}</span>
              {binding.confidence === 'suggested' && (
                <span className="text-muted-foreground shrink-0 rounded border border-dashed px-1.5 py-0.5 font-mono text-[10px]">
                  {tRole('suggested')}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={busy}
                onClick={() => run(unbind(binding.id))}
                aria-label={tRole('unbindAria', { name: documentLabel(binding), role: definition.label })}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
          {held.map((bind) => (
            <li
              key={`held-${bind.documentId}`}
              className="bg-muted/20 flex items-center gap-2 rounded-control border border-dashed px-3 py-2 text-sm"
            >
              <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{bind.filename}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{tRole('heldUntilSave')}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={busy}
                onClick={() => deferred?.onDiscard(bind)}
                aria-label={tRole('discardAria', { name: bind.filename, role: definition.label })}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {selectable.length > 0 && (
          <Select disabled={busy} value="" onValueChange={(value) => run(bind(value))}>
            <SelectTrigger className="h-9 max-w-xs pointer-coarse:h-11">
              <SelectValue
                placeholder={full ? tRole('pickOther') : tRole('pickExisting')}
              />
            </SelectTrigger>
            <SelectContent>
              {selectable.map((document) => (
                <SelectItem key={document.id} value={document.id}>
                  {documentLabel({
                    displayName: document.displayName ?? null,
                    filename: document.filename,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple={definition.cardinality === 'many'}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) upload(event.target.files)
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Paperclip className="size-4" aria-hidden />
          )}
          {tRole('upload')}
        </Button>

        {/* On site the document is often the wall in front of you: a photo, taken
            now. A file input with `capture` opens the camera directly on a phone
            instead of the photo library; a desktop has no use for it, so it is
            there on a touch pointer only. The photo is a document like any other
            upload and goes the same way (name screen, batch, binding). */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            if (event.target.files) upload(event.target.files)
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          className="pointer-fine:hidden"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-4" aria-hidden />
          {tRole('takePhoto')}
        </Button>
      </div>

      {/* Drag and drop is a pointer gesture; on a touch screen the line would
          promise something the reader cannot do, and it took the place of the
          two buttons above. */}
      <div
        {...dragHandlers}
        aria-label={tRole('dropAria', { role: definition.label })}
        data-testid="document-role-drop"
        data-dragging={isDragging || undefined}
        className={cn(
          'rounded-control border border-dashed px-3 py-2 text-center text-xs transition-colors duration-quick ease-out motion-reduce:transition-none pointer-coarse:hidden',
          isDragging && refusal && 'border-destructive bg-destructive/5 text-destructive',
          isDragging && !refusal && 'border-primary bg-primary/5 text-foreground',
          !isDragging && 'text-muted-foreground'
        )}
      >
        <Upload className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
        {refusal ?? (definition.cardinality === 'many' ? tRole('dropHereMany') : tRole('dropHereOne'))}
      </div>
    </div>
  )
}
