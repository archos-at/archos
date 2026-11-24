import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test-utils'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchField } from '@/components/ui/search-field'
import { Textarea } from '@/components/ui/textarea'
import { TypeToConfirmDialog } from '@/components/ui/type-to-confirm-dialog'
import { createDictationChannel } from '@/features/dictation'
import { ComposerField } from '@/features/layout/components/input-area/composer-field'
import type { InputAreaController } from '@/features/layout/components/input-area/use-input-area-controller'

const composerController = (): InputAreaController =>
  ({
    textareaRef: { current: null },
    message: '',
    draftLocked: false,
    isResponseMode: false,
    typingAhead: false,
    typeAheadHintId: 'type-ahead',
    mentionPickerOpen: false,
    mentionAria: {},
    reference: { open: false, aria: {} },
    slash: { open: false, aria: {}, invokedSkill: null, clearInvocation: vi.fn() },
    otherProjects: [],
    screeningHold: null,
    uploadError: null,
    composerNote: null,
    cannotContribute: false,
    dictationChannel: createDictationChannel(),
    locale: 'en',
    t: (key: string) => key,
    tCapture: (key: string) => key,
    getPlaceholder: () => '',
    handleValueChange: vi.fn(),
    handleKeyDown: vi.fn(),
    handlePaste: vi.fn(),
    noteSendIntent: vi.fn(),
    syncMentionQueryFromElement: vi.fn(),
    rememberDictationCaret: vi.fn(),
    clearError: vi.fn(),
    setComposerNote: vi.fn(),
    sendScreenedMasked: vi.fn(),
    editScreened: vi.fn(),
  }) as unknown as InputAreaController

describe('the shared field primitives raise themselves on a coarse pointer', () => {
  it.each([
    ['an input', () => <Input aria-label="Field" />, 'textbox'],
    ['a textarea', () => <Textarea aria-label="Field" />, 'textbox'],
    [
      'a select trigger',
      () => (
        <Select>
          <SelectTrigger aria-label="Field">
            <SelectValue />
          </SelectTrigger>
        </Select>
      ),
      'combobox',
    ],
  ] as const)('%s is 16px on a coarse pointer and never drops back at md', (_, ui, role) => {
    render(ui())
    const field = screen.getByRole(role, { name: 'Field' })
    expect(field).toHaveClass('pointer-coarse:text-base')
    expect(field).not.toHaveClass('md:text-sm')
  })
})

describe('the soft keyboard is told what the action key does', () => {
  it.each([
    [
      'the search field',
      'search',
      () => <SearchField value="" onChange={vi.fn()} placeholder="Search" label="Search" />,
    ],
    [
      'the type-to-confirm dialog',
      'done',
      () => (
        <TypeToConfirmDialog
          open
          onOpenChange={vi.fn()}
          title="Delete"
          description="Gone for good"
          confirmName="acme"
          confirmLabel="Delete"
          onConfirm={vi.fn()}
        />
      ),
    ],
    ['the composer', 'send', () => <ComposerField controller={composerController()} />],
  ] as const)('%s asks the phone for a "%s" action key', (_, hint, ui) => {
    render(ui())
    expect(screen.getByRole('textbox')).toHaveAttribute('enterkeyhint', hint)
  })

  it('keeps the phone from editing a search query on its way in', () => {
    render(<SearchField value="" onChange={vi.fn()} placeholder="Search" label="Search" />)
    const search = screen.getByRole('textbox', { name: 'Search' })
    expect(search).toHaveAttribute('autocapitalize', 'off')
    expect(search).toHaveAttribute('autocorrect', 'off')
  })
})
