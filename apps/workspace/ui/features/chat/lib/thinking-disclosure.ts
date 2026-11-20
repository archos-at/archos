export type CloseReason = 'fold' | 'toggle'

export interface Disclosure {
  open: boolean
  closeReason: CloseReason
  autoOpen: boolean | undefined
  userToggled: boolean
  autoOpened: boolean
}

export const nextDisclosure = (d: Disclosure, autoOpen: boolean | undefined): Disclosure => {
  let next = d
  if (autoOpen !== undefined && autoOpen !== d.autoOpen) {
    const wasDriven = d.autoOpen === true
    next = { ...next, autoOpen }
    if (autoOpen && !d.userToggled) {
      next = { ...next, open: true, autoOpened: true }
    } else if (!autoOpen && wasDriven) {
      if (!d.userToggled && d.autoOpened) next = { ...next, open: false, closeReason: 'fold' }
      next = { ...next, autoOpened: false }
    }
  }
  return next
}
