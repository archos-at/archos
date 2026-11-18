import { KeyTakeawaysCard } from '@/features/cards/components/KeyTakeawaysCard'
import { VerdictHeaderCard } from '@/features/cards/components/VerdictHeaderCard'
import { CalloutCard } from '@/features/cards/components/CalloutCard'
import { CalculationCard } from '@/features/cards/components/CalculationCard'
import { Section } from './gallery-section'
import { OIB2, OIB4, OIB6 } from './fixtures'

export function TextCardSections() {
  return (
    <>
      <Section id="key_takeaways">
        <KeyTakeawaysCard
          title="Gebäudeklasse 4 – was daraus folgt"
          items={[
            {
              text: 'Fluchtniveau 9,80 m → Gebäudeklasse 4',
              detail:
                'Maßgeblich ist das oberste Fluchtniveau über dem angrenzenden Gelände; die Grenze zu GK 5 liegt bei 11 m.',
            },
            {
              text: 'Tragende Bauteile mindestens REI 60',
              detail: 'In Kellergeschossen gilt REI 90, unabhängig von der Gebäudeklasse.',
            },
            {
              text: 'Treppenhaus als gesicherter Fluchtbereich erforderlich',
              detail:
                'Rauchdichte Abtrennung in jedem Geschoss; die Ausführung ist mit der Brandschutzplanung abzustimmen.',
            },
            { text: 'Barrierefreier Aufzug ab drei oberirdischen Geschossen' },
          ]}
        />
      </Section>

      {/* All four kinds side by side: the word carries the signal, the tone
          only reinforces it — which is exactly what has to be reviewable in
          both themes at once. */}
      <Section id="callout">
        <CalloutCard
          kind="note"
          text="Für Zu- und Umbauten im Bestand gelten die Anforderungen nur im Umfang des Eingriffs."
          detail="Wird die Gebäudeklasse durch den Zubau angehoben, ist das gesamte Gebäude neu zu beurteilen."
        />
        <CalloutCard
          kind="warning"
          title="Gilt nur in Wien"
          text="Die Wiener Bauordnung weicht bei der Berechnung des Fluchtniveaus von den übrigen Ländern ab."
        />
        <CalloutCard
          kind="deadline"
          text="Die Bauverhandlung ist binnen sechs Wochen nach Einreichung anzuberaumen."
          detail="Die Frist ruht, solange die Behörde eine Ergänzung des Einreichplans verlangt hat."
        />
        <CalloutCard
          kind="tip"
          text="Ein Schnitt durch das Treppenhaus mit eingetragenem Fluchtniveau erspart in der Regel eine Rückfrage der Behörde."
        />
      </Section>

      {/* Three derivations, chosen so the review question is „did the card
          compute this, and does the number agree with the verdict beside it?":
          the Schrittmaßregel inside its range with a propagated band; a GFZ
          over its limit; and a two-step U-value whose exact result (0,2504)
          would round to the limit itself, so the card must print the fourth
          decimal rather than contradict its own „nicht erfüllt". */}
      <Section id="calculation">
        <CalculationCard
          title="Schrittmaßregel – Treppenlauf Haus A"
          steps={[
            {
              label: 'Schrittmaß',
              operation: 'sum',
              unit: 'cm',
              operands: [
                {
                  label: 'Steigung',
                  value: 17,
                  unit: 'cm',
                  factor: 2,
                  provenance: 'computed',
                  tolerance: 0.5,
                  source: 'Einreichplan, Schnitt A-A',
                },
                { label: 'Auftritt', value: 30, unit: 'cm', provenance: 'declared' },
              ],
            },
          ]}
          limit={{
            comparator: 'between',
            value: 59,
            upper: 65,
            label: 'Schrittmaßregel',
            reference: OIB4,
          }}
        />
        <CalculationCard
          title="Geschossflächenzahl – Grundstück Musterweg 12"
          steps={[
            {
              label: 'GFZ',
              operation: 'quotient',
              operands: [
                { label: 'Bruttogeschossfläche', value: 2400, unit: 'm²', source: 'Flächenaufstellung, Stand 03/2026' },
                { label: 'Grundfläche', value: 800, unit: 'm²', provenance: 'declared' },
              ],
            },
          ]}
          limit={{ comparator: '<=', value: 2.5, label: 'Bebauungsplan PD 8123' }}
          note="Terrassen und Loggien sind in der Bruttogeschossfläche nicht enthalten."
        />
        <CalculationCard
          title="U-Wert Außenwand aus den Wärmedurchlasswiderständen"
          steps={[
            {
              label: 'Wärmedurchgangswiderstand',
              operation: 'sum',
              unit: 'm²K/W',
              operands: [
                { label: 'Rsi', value: 0.13, unit: 'm²K/W' },
                { label: 'Dämmung 20 cm', value: 3.5, unit: 'm²K/W' },
                { label: 'Ziegel 25 cm', value: 0.31, unit: 'm²K/W' },
                { label: 'Rse', value: 0.04, unit: 'm²K/W' },
              ],
            },
            {
              label: 'U-Wert',
              operation: 'quotient',
              unit: 'W/(m²K)',
              operands: [{ label: '', value: 1 }, { label: 'Rges', step: 1 }],
            },
          ]}
          limit={{ comparator: '<=', value: 0.25, reference: OIB6 }}
        />
      </Section>

      {/* The card IS the figure, so the thing to review is the figure: a short
          verdict at 30px, a long compound at the 24px step it drops to above 24
          characters, and the confidence gauge at all three of its levels —
          including the answer with no confidence at all, where the gauge is
          absent rather than empty. */}
      <Section id="verdict_header">
        <VerdictHeaderCard
          verdict="1,10 m"
          subject="Erforderliche Geländerhöhe"
          reference={OIB4}
          confidence="high"
          confidence_reason={null}
        />
      </Section>

      <Section id="verdict_header_long">
        <VerdictHeaderCard
          verdict="Hauptgeschoßfußbodenoberkante über 22 m"
          subject="Einstufung als Hochhaus"
          reference={OIB2}
          confidence="medium"
          confidence_reason="Die Wiener Bauordnung misst den Bezugspunkt abweichend; für ein Grundstück in Wien ist der Wert gesondert zu prüfen."
        />
      </Section>

      <Section id="verdict_header_bare">
        <VerdictHeaderCard
          verdict="Nicht geregelt"
          subject="Mindestbreite einer Wartungsleiter"
          reference={null}
          confidence="low"
          confidence_reason={null}
        />
      </Section>
    </>
  )
}
