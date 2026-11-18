import { renderHook, act } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { useFileDragDrop } from './use-file-drag-drop'

vi.mock('../validation', () => ({
  checkDraggedFilesSupported: vi.fn(() => true),
}))

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

import { checkDraggedFilesSupported } from '../validation'
import { FOLDER_DRAG_TYPE } from './use-document-drag'
import { LEGACY_FOLDER_DRAG_TYPE } from './legacy-drag-types'

function createMockDragEvent(files: File[] = [], items: DataTransferItem[] = []): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: ['Files'],
      files,
      items: items.length > 0 ? items : files.map(() => ({ kind: 'file', type: 'application/pdf' })),
    },
  } as unknown as React.DragEvent
}

function createInternalDragEvent(type = 'application/x-document-id'): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: [type],
      files: [],
      items: [{ kind: 'string', type }],
    },
  } as unknown as React.DragEvent
}

describe('useFileDragDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkDraggedFilesSupported).mockReturnValue(true)
  })

  test('returns initial state with isDragging false', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    expect(result.current.isDragging).toBe(false)
    expect(result.current.isUnsupportedDrag).toBe(false)
    expect(result.current.dragHandlers).toBeDefined()
    expect(result.current.dragHandlers.onDragEnter).toBeInstanceOf(Function)
    expect(result.current.dragHandlers.onDragLeave).toBeInstanceOf(Function)
    expect(result.current.dragHandlers.onDragOver).toBeInstanceOf(Function)
    expect(result.current.dragHandlers.onDrop).toBeInstanceOf(Function)
  })

  test('sets isDragging to true on dragEnter with files', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const mockEvent = createMockDragEvent(
      [new File(['content'], 'test.pdf', { type: 'application/pdf' })],
      [{ kind: 'file', type: 'application/pdf' } as DataTransferItem]
    )

    act(() => {
      result.current.dragHandlers.onDragEnter(mockEvent)
    })

    expect(result.current.isDragging).toBe(true)
    expect(mockEvent.preventDefault).toHaveBeenCalled()
    expect(mockEvent.stopPropagation).toHaveBeenCalled()
  })

  test('asks whether a zip counts only when the surface unpacks them', () => {
    vi.mocked(checkDraggedFilesSupported).mockClear()
    const zip = createMockDragEvent(
      [new File(['z'], 'a.zip')],
      [{ kind: 'file', type: 'application/zip' } as DataTransferItem]
    )

    const chat = renderHook(() => useFileDragDrop({ onDrop: vi.fn() }))
    act(() => chat.result.current.dragHandlers.onDragEnter(zip))
    const shelf = renderHook(() => useFileDragDrop({ onDrop: vi.fn(), acceptZip: true }))
    act(() => shelf.result.current.dragHandlers.onDragEnter(zip))

    const options = vi.mocked(checkDraggedFilesSupported).mock.calls.map((call) => call[2])
    expect(options).toEqual([{ allowZip: false }, { allowZip: true }])
  })

  test('sets isUnsupportedDrag when files are unsupported', () => {
    vi.mocked(checkDraggedFilesSupported).mockReturnValue(false)

    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const mockEvent = createMockDragEvent(
      [new File(['content'], 'test.exe', { type: 'application/x-msdownload' })],
      [{ kind: 'file', type: 'application/x-msdownload' } as DataTransferItem]
    )

    act(() => {
      result.current.dragHandlers.onDragEnter(mockEvent)
    })

    expect(result.current.isDragging).toBe(true)
    expect(result.current.isUnsupportedDrag).toBe(true)
  })

  test('resets isDragging on dragLeave when counter reaches zero', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const enterEvent = createMockDragEvent(
      [new File(['content'], 'test.pdf', { type: 'application/pdf' })],
      [{ kind: 'file', type: 'application/pdf' } as DataTransferItem]
    )

    act(() => {
      result.current.dragHandlers.onDragEnter(enterEvent)
    })
    expect(result.current.isDragging).toBe(true)

    const leaveEvent = createMockDragEvent()
    act(() => {
      result.current.dragHandlers.onDragLeave(leaveEvent)
    })
    expect(result.current.isDragging).toBe(false)
  })

  test('keeps isDragging true with nested drag enter/leave', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const enterEvent = createMockDragEvent(
      [new File(['content'], 'test.pdf', { type: 'application/pdf' })],
      [{ kind: 'file', type: 'application/pdf' } as DataTransferItem]
    )
    const leaveEvent = createMockDragEvent()

    act(() => {
      result.current.dragHandlers.onDragEnter(enterEvent)
    })
    act(() => {
      result.current.dragHandlers.onDragEnter(enterEvent)
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      result.current.dragHandlers.onDragLeave(leaveEvent)
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      result.current.dragHandlers.onDragLeave(leaveEvent)
    })
    expect(result.current.isDragging).toBe(false)
  })

  test('calls onDrop with files and resets state', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    const enterEvent = createMockDragEvent(
      [file],
      [{ kind: 'file', type: 'application/pdf' } as DataTransferItem]
    )
    const dropEvent = createMockDragEvent([file])

    act(() => {
      result.current.dragHandlers.onDragEnter(enterEvent)
    })
    expect(result.current.isDragging).toBe(true)

    await act(async () => {
      result.current.dragHandlers.onDrop(dropEvent)
    })

    expect(onDrop).toHaveBeenCalledWith([file], { truncated: false, unreadable: 0 })
    expect(result.current.isDragging).toBe(false)
    expect(result.current.isUnsupportedDrag).toBe(false)
    expect(dropEvent.preventDefault).toHaveBeenCalled()
    expect(dropEvent.stopPropagation).toHaveBeenCalled()
  })

  test('does not call onDrop with empty files', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const dropEvent = createMockDragEvent([])

    await act(async () => {
      result.current.dragHandlers.onDrop(dropEvent)
    })

    expect(onDrop).not.toHaveBeenCalled()
  })

  test('does not trigger drag events when disabled', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop, disabled: true }))

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    const enterEvent = createMockDragEvent(
      [file],
      [{ kind: 'file', type: 'application/pdf' } as DataTransferItem]
    )

    act(() => {
      result.current.dragHandlers.onDragEnter(enterEvent)
    })

    expect(result.current.isDragging).toBe(false)
  })

  test('does not call onDrop when disabled', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop, disabled: true }))

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    const dropEvent = createMockDragEvent([file])

    await act(async () => {
      result.current.dragHandlers.onDrop(dropEvent)
    })

    expect(onDrop).not.toHaveBeenCalled()
  })

  test('onDragOver prevents default', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const overEvent = createMockDragEvent()

    act(() => {
      result.current.dragHandlers.onDragOver(overEvent)
    })

    expect(overEvent.preventDefault).toHaveBeenCalled()
    expect(overEvent.stopPropagation).toHaveBeenCalled()
  })

  test('handles multiple files on drop', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    const files = [
      new File(['content1'], 'test1.pdf', { type: 'application/pdf' }),
      new File(['content2'], 'test2.pdf', { type: 'application/pdf' }),
      new File(['content3'], 'test3.txt', { type: 'text/plain' }),
    ]
    const dropEvent = createMockDragEvent(files)

    await act(async () => {
      result.current.dragHandlers.onDrop(dropEvent)
    })

    expect(onDrop).toHaveBeenCalledWith(files, { truncated: false, unreadable: 0 })
    expect(onDrop).toHaveBeenCalledTimes(1)
  })
})

describe('useFileDragDrop — an in-app drag is not an upload', () => {
  test('ignores a document drag entirely', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    act(() => result.current.dragHandlers.onDragEnter(createInternalDragEvent()))

    expect(result.current.isDragging).toBe(false)
    expect(result.current.isUnsupportedDrag).toBe(false)
  })

  test.each([FOLDER_DRAG_TYPE, LEGACY_FOLDER_DRAG_TYPE])('ignores a folder drag entirely (%s)', (type) => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    act(() => result.current.dragHandlers.onDragEnter(createInternalDragEvent(type)))

    expect(result.current.isDragging).toBe(false)
  })

  test('leaves the drop to the folder under the pointer', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))
    const event = createInternalDragEvent()

    act(() => result.current.dragHandlers.onDrop(event))

    expect(onDrop).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('an uncounted leave cannot strand the overlay on the next real upload', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))

    act(() => result.current.dragHandlers.onDragLeave(createInternalDragEvent()))
    act(() => result.current.dragHandlers.onDragLeave(createInternalDragEvent()))

    act(() => result.current.dragHandlers.onDragEnter(createMockDragEvent([new File(['x'], 'a.pdf')])))
    expect(result.current.isDragging).toBe(true)
    act(() => result.current.dragHandlers.onDragLeave(createMockDragEvent([new File(['x'], 'a.pdf')])))
    expect(result.current.isDragging).toBe(false)
  })
})

describe('useFileDragDrop — a drop the entries API cannot read', () => {
  function transferThatEmptiesAfterTheEvent(files: File[]): React.DragEvent {
    let dispatching = true
    queueMicrotask(() => {
      dispatching = false
    })
    const failingEntry = {
      isFile: true,
      isDirectory: false,
      name: files[0]?.name ?? '',
      file: (_ok: (file: File) => void, fail: (error: unknown) => void) =>
        setTimeout(() => fail(new Error('NotFoundError')), 0),
    }
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        get files() {
          return dispatching ? files : []
        },
        items: files.map(() => ({ kind: 'file', type: 'application/pdf', webkitGetAsEntry: () => failingEntry })),
      },
    } as unknown as React.DragEvent
  }

  test('still uploads the files the event carried', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop }))
    const files = [new File(['x'], 'Anhang aus Outlook.pdf', { type: 'application/pdf' })]

    await act(async () => {
      result.current.dragHandlers.onDrop(transferThatEmptiesAfterTheEvent(files))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(onDrop).toHaveBeenCalledWith(files, { truncated: false, unreadable: 0 })
  })
})

describe('useFileDragDrop — off, refused, and ended elsewhere', () => {
  const pdf = () => [new File(['x'], 'Plan.pdf', { type: 'application/pdf' })]

  test('a disabled zone claims nothing, so the drop falls through to what is around it', () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop, disabled: true }))
    const enter = createMockDragEvent(pdf())
    const over = createMockDragEvent(pdf())
    const drop = createMockDragEvent(pdf())

    act(() => {
      result.current.dragHandlers.onDragEnter(enter)
      result.current.dragHandlers.onDragOver(over)
      result.current.dragHandlers.onDrop(drop)
    })

    for (const event of [enter, over, drop]) {
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(event.stopPropagation).not.toHaveBeenCalled()
    }
    expect(result.current.isDragging).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
  })

  test('a refusing zone shows its reason, says „no drop" to the cursor, and delivers nothing', async () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDragDrop({ onDrop, refusal: 'Nur lesen' }))
    expect(result.current.refusal).toBeNull()

    const over = createMockDragEvent(pdf())
    act(() => {
      result.current.dragHandlers.onDragEnter(createMockDragEvent(pdf()))
      result.current.dragHandlers.onDragOver(over)
    })
    expect(result.current.isDragging).toBe(true)
    expect(result.current.refusal).toBe('Nur lesen')
    expect(over.preventDefault).toHaveBeenCalled()
    expect(over.dataTransfer.dropEffect).toBe('none')

    const drop = createMockDragEvent(pdf())
    await act(async () => {
      result.current.dragHandlers.onDrop(drop)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(drop.preventDefault).toHaveBeenCalled()
    expect(onDrop).not.toHaveBeenCalled()
    expect(result.current.isDragging).toBe(false)
  })

  test('an accepting zone says „copy"', () => {
    const { result } = renderHook(() => useFileDragDrop({ onDrop: vi.fn() }))
    const over = createMockDragEvent(pdf())
    act(() => result.current.dragHandlers.onDragOver(over))
    expect(over.dataTransfer.dropEffect).toBe('copy')
  })

  test('the overlay clears when the drag ends on another zone, which stops the drop there', () => {
    const { result } = renderHook(() => useFileDragDrop({ onDrop: vi.fn() }))
    act(() => result.current.dragHandlers.onDragEnter(createMockDragEvent(pdf())))
    expect(result.current.isDragging).toBe(true)

    const tile = document.createElement('div')
    document.body.appendChild(tile)
    tile.addEventListener('drop', (event) => event.stopPropagation())
    act(() => {
      tile.dispatchEvent(new Event('drop', { bubbles: true }))
    })
    expect(result.current.isDragging).toBe(false)
    tile.remove()
  })

  test('the overlay clears when the drag is cancelled (Escape) or leaves the window', () => {
    const { result } = renderHook(() => useFileDragDrop({ onDrop: vi.fn() }))
    act(() => result.current.dragHandlers.onDragEnter(createMockDragEvent(pdf())))
    act(() => {
      window.dispatchEvent(new Event('dragend'))
    })
    expect(result.current.isDragging).toBe(false)

    act(() => result.current.dragHandlers.onDragEnter(createMockDragEvent(pdf())))
    expect(result.current.isDragging).toBe(true)
    const leave = new MouseEvent('dragleave', { bubbles: true, clientX: 0, clientY: 200, relatedTarget: null })
    act(() => {
      document.body.dispatchEvent(leave)
    })
    expect(result.current.isDragging).toBe(false)
  })

  test('a leave from one child to another inside the window keeps the overlay', () => {
    const { result } = renderHook(() => useFileDragDrop({ onDrop: vi.fn() }))
    act(() => result.current.dragHandlers.onDragEnter(createMockDragEvent(pdf())))
    const leave = new MouseEvent('dragleave', {
      bubbles: true,
      clientX: 200,
      clientY: 200,
      relatedTarget: document.body,
    })
    act(() => {
      document.body.dispatchEvent(leave)
    })
    expect(result.current.isDragging).toBe(true)
  })
})
