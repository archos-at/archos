import React from 'react'
import { Link as PdfLink, Text as PdfText } from '@react-pdf/renderer'
import type { LinkProps, TextProps } from '@react-pdf/renderer'

import { printable } from './printable'

export function Text({
  children,
  ...props
}: React.PropsWithChildren<TextProps>): React.JSX.Element {
  return (
    <PdfText {...props}>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? printable(child) : child
      )}
    </PdfText>
  )
}

export function Link({ children, ...props }: React.PropsWithChildren<LinkProps>): React.JSX.Element {
  return (
    <PdfLink {...props}>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? printable(child) : child
      )}
    </PdfLink>
  )
}
