'use client'

import type { JSX } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentActionsMenu, useMoveInSheet } from '@/features/documents/components/document-actions'
import { RenameDocumentDialog } from '@/features/documents/components/document-actions/rename-document-dialog'

const DOCUMENT = {
  id: 'dev-doc-1',
  filename: 'Brandschutzkonzept_Wohnbau-Nord_GK4.pdf',
  displayName: 'Brandschutzkonzept Wohnbau Nord.pdf',
  folderId: 'f-brand',
  status: 'processing',
}

const DRAWING = {
  id: 'dev-doc-2',
  filename: 'Katasterauszug_KG16117_Gst123-4.dxf',
  displayName: 'Katasterauszug Mödling.dxf',
  folderId: 'f-arch',
  contentType: 'application/dxf',
  status: 'indexed',
}

const FOLDERS = [
  { id: 'f-brand', name: 'Brandschutz', parentId: null },
  { id: 'f-flucht', name: 'Fluchtwege', parentId: 'f-brand' },
  { id: 'f-statik', name: 'Statik', parentId: null },
  { id: 'f-arch', name: 'Architektur', parentId: null },
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __documentActionsShim?: boolean }
  if (!w.__documentActionsShim) {
    w.__documentActionsShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (/\/api\/documents\/[^/]+\/folder$/.test(url)) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { folderId?: string | null }
        return Response.json({ id: 'dev-doc-1', folderId: body.folderId ?? null })
      }
      return real(input, init)
    }
  }
}

function useOpenMoveMenu(pick: boolean, enabled = true): void {
  const driven = useRef(false)
  useEffect(() => {
    if (driven.current || !enabled) return
    driven.current = true
    const press = (node: Element | null) =>
      node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="document-actions-trigger"]')
    if (!trigger) return
    trigger.focus()
    press(trigger)
    window.requestAnimationFrame(() => {
      const sub = document.querySelector<HTMLElement>('[data-testid="document-action-move"]')
      sub?.focus()
      press(sub)
      if (!pick) return
      window.requestAnimationFrame(() => {
        const sheetRow = document.querySelector<HTMLElement>('[data-testid="folder-picker-f-statik"]')
        if (sheetRow) {
          sheetRow.click()
          return
        }
        const items = Array.from(
          document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-content"] [role="menuitem"]')
        )
        const structuralFolder = items.find((item) => item.textContent?.trim() === 'Statik')
        structuralFolder?.focus()
        structuralFolder?.click()
      })
    })
  }, [pick, enabled])
}

function useOpenMenu(enabled: boolean): void {
  const driven = useRef(false)
  useEffect(() => {
    if (driven.current || !enabled) return
    driven.current = true
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="document-actions-trigger"]')
    trigger?.focus()
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }, [enabled])
}

function HeaderRow({
  onMoved,
  drawing = false,
}: {
  onMoved?: (id: string, folderId: string | null) => void
  drawing?: boolean
}): JSX.Element {
  const moveInSheet = useMoveInSheet()
  const document = drawing ? DRAWING : DOCUMENT
  return (
    <div className="mx-auto flex w-full max-w-[720px] items-center gap-3 rounded-2xl border bg-card px-5 py-3.5 shadow-2xs">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-bold uppercase leading-none text-muted-foreground"
        aria-hidden
      >
        {drawing ? 'DXF' : 'PDF'}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">
          {document.displayName}
        </h3>
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground">
          {drawing ? 'DXF · Maßstab 1:500 · Bereit' : 'PDF · Bereit'}
        </p>
      </div>
      <Button type="button" variant="secondary" size="sm" className="h-8 shrink-0 gap-1.5 px-3">
        <Download className="size-3.5" aria-hidden />
        Herunterladen
      </Button>
      <DocumentActionsMenu
        document={document}
        scope="files"
        actions={drawing ? ['downloadPdf', 'rename', 'move', 'delete'] : ['rename', 'move', 'cancel', 'delete']}
        folders={FOLDERS}
        moveInSheet={moveInSheet}
        onMoved={onMoved ?? (() => {})}
      />
    </div>
  )
}

function DocumentActionsPreview(): JSX.Element {
  const variant = useSearchParams()?.get('variant') ?? 'rename'
  const isMove = variant === 'move' || variant === 'moved'
  const isDrawing = variant === 'drawing'
  const [moved, setMoved] = useState<string | null>(null)
  useOpenMoveMenu(variant === 'moved', !isDrawing)
  useOpenMenu(isDrawing)

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-muted/30 p-8" data-testid="document-actions-preview">
      <HeaderRow
        drawing={isDrawing}
        onMoved={isMove ? (id, folderId) => setMoved(`${id} → ${folderId ?? 'root'}`) : undefined}
      />

      {moved && (
        <p className="mx-auto mt-4 text-sm text-muted-foreground" data-testid="document-moved-result">
          onMoved: {moved}
        </p>
      )}

      {isMove || isDrawing ? null : variant === 'delete' ? (
        <ConfirmDialog
          open
          onOpenChange={() => {}}
          title={`„${DOCUMENT.displayName}“ löschen?`}
          description="Dadurch wird das Dokument aus diesem Projekt entfernt. Dies kann nicht rückgängig gemacht werden."
          confirmLabel="Löschen"
          cancelLabel="Abbrechen"
          onConfirm={() => {}}
        />
      ) : (
        <RenameDocumentDialog
          open
          onOpenChange={() => {}}
          document={DOCUMENT}
          scope="files"
          onRename={() => Promise.resolve(false)}
        />
      )}
    </div>
  )
}

export default function DocumentActionsDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <Suspense fallback={<div />}>
      <DocumentActionsPreview />
    </Suspense>
  )
}
