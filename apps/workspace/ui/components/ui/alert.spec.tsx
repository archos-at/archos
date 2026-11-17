import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert, AlertDescription, AlertTitle } from './alert'

describe('Alert variant="destructive"', () => {
  it('draws its words in ink and only the glyph in the error red', () => {
    render(
      <Alert variant="destructive" data-testid="alert">
        <svg aria-hidden />
        <AlertTitle>Konnte nicht geladen werden</AlertTitle>
        <AlertDescription>Bitte erneut versuchen.</AlertDescription>
      </Alert>
    )
    const classes = screen.getByTestId('alert').className.split(/\s+/)
    expect(classes).toContain('text-foreground')
    expect(classes).toContain('[&>svg]:text-error')
    expect(classes).toContain('*:data-[slot=alert-description]:text-foreground')
    expect(classes).not.toContain('text-error')
    expect(classes).not.toContain('*:data-[slot=alert-description]:text-error')
  })
})
