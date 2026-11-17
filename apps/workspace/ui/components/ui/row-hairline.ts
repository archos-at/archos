export const ROW_HAIRLINE_LINE =
  'relative after:pointer-events-none after:absolute after:bottom-0 after:left-[var(--row-text,0px)] after:right-[var(--row-end,0px)] after:h-px after:bg-hairline data-filled:after:hidden [&:has(+[data-filled])]:after:hidden'
export const ROW_HAIRLINE = `${ROW_HAIRLINE_LINE} last:after:hidden`

export const ROW_REVEAL =
  'pointer-coarse:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-aria-selected/row:opacity-100 group-data-[state=selected]/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity duration-quick ease-out motion-reduce:transition-none'

export const TABLE_ROW_HAIRLINE =
  '[&>td]:bg-[image:linear-gradient(var(--hairline),var(--hairline))] [&>td]:bg-no-repeat [&>td]:bg-bottom [&>td]:bg-[length:100%_1px] [&>td[data-row-text]]:bg-right-bottom [&>td[data-row-text]]:bg-[length:calc(100%-var(--row-lead,0px))_1px] [&>td:last-child]:bg-left-bottom [&>td:last-child]:bg-[length:calc(100%-var(--row-end,0px))_1px] [&>td[data-row-skip]]:bg-none last:[&>td]:bg-none data-filled:[&>td]:bg-none [&:has(+[data-filled])>td]:bg-none'
