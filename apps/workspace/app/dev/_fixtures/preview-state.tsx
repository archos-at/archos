'use client'

/**
 * A preview's selectable state: a row of toggles, and `?state=<name>` in the
 * address so a capture can open one state directly.
 */

import { useEffect, useState, type JSX } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function usePreviewState<State extends string>(states: readonly State[]): [State, (state: State) => void] {
  const [state, setState] = useState<State>(states[0])
  // After mount: the address is the browser's, and the first render must match the server's.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('state')
    const match = states.find((candidate) => candidate === asked)
    if (match) setState(match)
  }, [states])
  return [state, setState]
}

export function PreviewStatePicker<State extends string>({
  label,
  states,
  value,
  onChange,
}: {
  label: string
  states: readonly State[]
  value: State
  onChange: (state: State) => void
}): JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const match = states.find((candidate) => candidate === next)
        if (match) onChange(match)
      }}
      className="flex-wrap justify-start"
      data-testid="preview-state-picker"
    >
      {states.map((state) => (
        <ToggleGroupItem key={state} value={state}>
          {state}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
