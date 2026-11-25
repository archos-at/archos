import { describe, expect, it } from 'vitest'
import { render } from '@/test-utils'
import { AuthorityTag, labelNamesAuthority } from './AuthorityTag'

describe('the authority badge beside a source label', () => {
  it('stays away when the label already names the authority, as a word anywhere in it', () => {
    expect(labelNamesAuthority('Rechtsquelle (RIS)', 'RIS')).toBe(true)
    expect(labelNamesAuthority('OIB-Richtlinie 2.1, Ausgabe 2023', 'OIB')).toBe(true)
    expect(labelNamesAuthority('ris-Abfrage', 'RIS')).toBe(true)
  })

  it('stands beside a label that does not name it, and never matches inside a word', () => {
    expect(labelNamesAuthority('Bauordnung für Wien § 1', 'RIS')).toBe(false)
    expect(labelNamesAuthority('Parisgasse 4, Einreichplan', 'RIS')).toBe(false)
  })

  it('renders one label for „Rechtsquelle (RIS)“, never „RIS Rechtsquelle (RIS)“', () => {
    const { container } = render(
      <span>
        <AuthorityTag authority="RIS" label="Rechtsquelle (RIS)" />
        Rechtsquelle (RIS)
      </span>
    )
    expect(container.textContent).toBe('Rechtsquelle (RIS)')
    const { container: other } = render(<AuthorityTag authority="RIS" label="Bauordnung für Wien" />)
    expect(other.textContent).toBe('RIS')
  })
})
