import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { useNormRecognition } from './use-norm-recognition'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/adapters/api/base-knowledge-client', () => ({
  recognizeNorms: vi.fn(async () => {
    throw new Error('offline')
  }),
  onNormsSettled: () => () => undefined,
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider initialLocale="de" fixedLocale>
    {children}
  </I18nProvider>
)

afterEach(() => toast.error.mockReset())

describe('when the recognition cannot be shown', () => {
  it('says the recognised norms of an upload wait to be confirmed', async () => {
    const { result } = renderHook(() => useNormRecognition(), { wrapper })
    await act(() => result.current.recognize(['doc-1'], { source: 'office_shelf_upload' }))
    expect(toast.error).toHaveBeenCalledWith(
      'Die erkannten Normen konnten nicht angezeigt werden. Sie warten unter „Zu bestätigen“ in Normen & Richtlinien; alle anderen Dateien liegen in ihrem Ordner.',
    )
  })

  it('says a file taken as a norm by hand stays in its folder', async () => {
    const { result } = renderHook(() => useNormRecognition(), { wrapper })
    await act(() => result.current.recognize(['doc-1'], { source: 'folder_migration', asNorm: true }))
    expect(toast.error).toHaveBeenCalledWith('Die Datei konnte nicht als Norm übernommen werden und bleibt in ihrem Ordner. Versuchen Sie es noch einmal.')
  })
})
