'use client'

import { useCallback, useMemo, useReducer } from 'react'

export interface ActiveRegion {
  active: number | null
  pinned: number | null
  preview: (number: number | null) => void
  pin: (number: number | null) => void
}

interface State {
  previewed: number | null
  pinned: number | null
}

type Action = { type: 'preview'; number: number | null } | { type: 'pin'; number: number | null }

function reduce(state: State, action: Action): State {
  if (action.type === 'preview') {
    return state.previewed === action.number ? state : { ...state, previewed: action.number }
  }
  return state.pinned === action.number ? state : { ...state, pinned: action.number }
}

export function useActiveRegion(): ActiveRegion {
  const [state, dispatch] = useReducer(reduce, { previewed: null, pinned: null })
  const preview = useCallback((number: number | null) => dispatch({ type: 'preview', number }), [])
  const pin = useCallback((number: number | null) => dispatch({ type: 'pin', number }), [])
  return useMemo(
    () => ({ active: state.previewed ?? state.pinned, pinned: state.pinned, preview, pin }),
    [state, preview, pin],
  )
}
