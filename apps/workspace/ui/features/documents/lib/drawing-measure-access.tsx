'use client'

/**
 * Whether the organization holds the `drawing-measure` entitlement, for the
 * client components that show something only then (calibrating in the review
 * view).
 *
 * A flag arrives in the session's token, which only the server reads: the
 * `/app` layout computes it (`isDrawingMeasureEnabled`) and mounts this
 * provider, the way every other flag reaches the client as a value a server
 * component computed. A context and not a prop, because the review view is
 * reached through the files page, the office shelf and the chat's peek, and a
 * prop would thread through each of them.
 *
 * A rendering hint, never authorization: the routes check the flag themselves.
 * With no provider mounted the answer is no, so a surface outside `/app` shows
 * nothing new.
 */

import type { JSX, ReactNode } from 'react'
import { createContext, useContext } from 'react'

const DrawingMeasureContext = createContext(false)

export function DrawingMeasureAccess({ enabled, children }: { enabled: boolean; children: ReactNode }): JSX.Element {
  return <DrawingMeasureContext.Provider value={enabled}>{children}</DrawingMeasureContext.Provider>
}

/** True where the organization may have drawings measured, and so calibrated. */
export function useDrawingMeasureEnabled(): boolean {
  return useContext(DrawingMeasureContext)
}
