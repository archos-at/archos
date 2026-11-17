'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { ShareDialog } from '@/features/collaboration/components/ShareDialog'
import { useSharing } from '@/features/collaboration/hooks/use-sharing'
import type {
  AccessReason,
  ResourceAccessEntry,
  ResourceRole,
  ResourceSharingState,
  ShareCandidate,
} from '@/lib/sharing/types'

const ME = 'u-matthias'
const RESOURCE_ID = 'c-atrium'

type Variant = 'default' | 'viewer' | 'invite' | 'project' | 'folders' | 'failure' | 'loading'

const VARIANTS: readonly Variant[] = ['viewer', 'invite', 'project', 'folders', 'failure', 'loading']

const readVariant = (): Variant => {
  if (typeof window === 'undefined') return 'default'
  const value = new URLSearchParams(window.location.search).get('variant') as Variant | null
  return value && VARIANTS.includes(value) ? value : 'default'
}

const entry = (
  userId: string,
  name: string,
  role: ResourceRole,
  reason: AccessReason,
  grantedBy: string | null = null,
): ResourceAccessEntry => ({
  person: { userId, name, email: `${name.split(' ')[0]?.toLowerCase()}@buero.at`, profilePictureUrl: null },
  role,
  reason,
  grantedBy,
})

const ENTRIES: ResourceAccessEntry[] = [
  entry(ME, 'Matthias Bigl', 'owner', 'creator'),
  entry('u-anna', 'Anna Weber', 'collaborator', 'grant', ME),
  entry('u-zoe', 'Zoe Vogel', 'viewer', 'grant', 'u-deactivated'),
]

const PROJECT_ENTRIES: ResourceAccessEntry[] = [
  entry(ME, 'Matthias Bigl', 'owner', 'creator'),
  entry('u-anna', 'Anna Weber', 'collaborator', 'grant', ME),
  entry('u-klaus', 'Klaus Berger', 'collaborator', 'visibility-project'),
  entry('u-markus', 'Markus Hofer', 'viewer', 'visibility-project'),
]

const FOLDER_ENTRIES: ResourceAccessEntry[] = ENTRIES.map((candidate) =>
  candidate.person.userId === 'u-zoe' ? { ...candidate, lostAccess: true } : { ...candidate, lostAccess: false },
)

const CANDIDATES: ShareCandidate[] = [
  {
    person: { userId: 'u-sabine', name: 'Sabine Gruber', email: 'sabine@buero.at', profilePictureUrl: null },
    alreadyHasAccess: false,
    needsProjectAccess: false,
  },
  {
    person: { userId: 'u-anna', name: 'Anna Weber', email: 'anna@buero.at', profilePictureUrl: null },
    alreadyHasAccess: true,
    needsProjectAccess: false,
  },
  {
    person: { userId: 'u-eva', name: 'Eva Ritter', email: 'eva@buero.at', profilePictureUrl: null },
    alreadyHasAccess: false,
    needsProjectAccess: true,
  },
]

const INA: ShareCandidate = {
  person: { userId: 'u-ina', name: 'Ina Praktikantin', email: 'ina@buero.at', profilePictureUrl: null },
  alreadyHasAccess: false,
  needsProjectAccess: false,
  lacksFolderAccess: true,
}

const sharingState = (variant: Variant): ResourceSharingState => ({
  resourceType: 'conversation',
  resourceId: RESOURCE_ID,
  visibility: variant === 'project' ? 'project' : 'private',
  allowedVisibilities: ['private', 'project'],
  myRole: variant === 'viewer' ? 'collaborator' : 'owner',
  canManage: variant !== 'viewer',
  canEscalate: false,
  shared: true,
  entries:
    variant === 'invite'
      ? [ENTRIES[0]]
      : variant === 'project'
        ? PROJECT_ENTRIES
        : variant === 'folders'
          ? FOLDER_ENTRIES
          : ENTRIES,
})

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __sharingShim?: boolean }
  if (!w.__sharingShim) {
    w.__sharingShim = true
    const real = window.fetch.bind(window)
    const base = `/api/sharing/conversation/${RESOURCE_ID}`
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const variant = readVariant()

      if (url.startsWith(`${base}/candidates`)) {
        return Response.json(
          variant === 'folders' ? [...CANDIDATES.map((c) => ({ ...c, lacksFolderAccess: false })), INA] : CANDIDATES,
        )
      }
      if (url.startsWith(`${base}/grants`) || url.startsWith(base)) {
        if (variant === 'loading') return new Promise<Response>(() => {})
        const method = (init?.method ?? 'GET').toUpperCase()
        if (variant === 'failure' && method !== 'GET') {
          return Response.json(
            { error: 'CONFLICT', code: 'CONFLICT', details: { reason: 'last-owner' } },
            { status: 409 },
          )
        }
        return Response.json(sharingState(variant))
      }
      if (url.startsWith('/api/stream')) {
        return new Response(null, { status: 404 })
      }
      return real(input, init)
    }
  }
}

function Preview({ variant }: { variant: Variant }): JSX.Element {
  const sharing = useSharing('conversation', RESOURCE_ID, true)
  const [open, setOpen] = useState(true)

  const loaded = Boolean(sharing.state)
  useEffect(() => {
    if (variant !== 'failure' || !loaded) return
    void sharing.changeRole('u-anna', 'viewer')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, loaded])

  return (
    <>
      {!open && (
        <button
          type="button"
          className="rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-xs"
          onClick={() => setOpen(true)}
        >
          Teilen öffnen
        </button>
      )}
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        resourceId={RESOURCE_ID}
        sharing={sharing}
        currentUserId={ME}
        shareUrl={`https://piloti.example/app/projects/p-atrium/chat?session=${RESOURCE_ID}`}
      />
    </>
  )
}

export default function ShareDialogDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [variant, setVariant] = useState<Variant | null>(null)
  useEffect(() => {
    setVariant(readVariant())
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="share-dialog-preview"
        className="mx-auto flex max-w-3xl flex-col gap-6 p-8 text-foreground"
      >
        <div>
          <h1 className="text-xl font-semibold">Teilen</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Die eine Freigabe-Oberfläche: Sichtbarkeit, Personen mit Zugriff und Einladen.
          </p>
        </div>

        {variant && <Preview variant={variant} />}
      </main>
    </I18nProvider>
  )
}
