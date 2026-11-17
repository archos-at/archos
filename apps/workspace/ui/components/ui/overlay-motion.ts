export const OVERLAY_ENTER =
  'data-[state=open]:duration-base data-[state=open]:ease-entrance'

export const OVERLAY_EXIT = 'data-[state=closed]:duration-quick data-[state=closed]:ease-exit'

export const OVERLAY_REDUCED = 'motion-reduce:animate-none'

export const OVERLAY_MOTION = `${OVERLAY_ENTER} ${OVERLAY_EXIT} ${OVERLAY_REDUCED}`
