export const peekHasRoom = (pathname: string | null | undefined, isMobile: boolean): boolean =>
  !isMobile && Boolean(pathname?.includes('/chat'))
