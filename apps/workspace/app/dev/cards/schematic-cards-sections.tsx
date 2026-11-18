import { BuildingSectionCard } from '@/features/cards/schematics/BuildingSectionCard'
import { StairDiagramCard } from '@/features/cards/schematics/StairDiagramCard'
import { DimensionDiagramCard } from '@/features/cards/schematics/DimensionDiagramCard'
import { SetbackPlanCard } from '@/features/cards/schematics/SetbackPlanCard'
import { EgressDiagramCard } from '@/features/cards/schematics/EgressDiagramCard'
import { DaylightIncidenceCard } from '@/features/cards/schematics/DaylightIncidenceCard'
import { GuardrailCheckCard } from '@/features/cards/schematics/GuardrailCheckCard'
import { FireAccessPlanCard } from '@/features/cards/schematics/FireAccessPlanCard'
import { Section } from './gallery-section'
import { OIB2, OIB3, OIB4 } from './fixtures'

export function SchematicCardSections() {
  return (
    <>
      <Section id="building_section">
        <BuildingSectionCard
          title="Gebäudeschnitt – Höhenprüfung GK4"
          storeys={[
            { label: 'KG', height_m: 2.5, below_grade: true },
            { label: 'EG', height_m: 3.2 },
            { label: '1.OG', height_m: 3.0 },
            { label: '2.OG', height_m: 3.0 },
            { label: '3.OG', height_m: 3.0 },
          ]}
          markers={[
            { label: 'Fluchtniveau', height_m: 9.2, kind: 'escape_level' },
            { label: 'GK4-Grenze', height_m: 11, kind: 'threshold' },
          ]}
          reference={OIB2}
          note="Das Fluchtniveau liegt unter der GK4-Grenze von 11 m."
        />
      </Section>

      <Section id="stair_diagram">
        <StairDiagramCard
          title="Treppenlauf – Steigungsverhältnis"
          riser_count={17}
          riser_height={{ label: 'Steigung', value: 17.6, required: 18, unit: 'cm', comparator: '<=', status: 'pass' }}
          tread_depth={{ label: 'Auftritt', value: 28, required: 28, unit: 'cm', comparator: '>=', status: 'pass' }}
          width={{ label: 'Nutzbare Laufbreite', value: 110, required: 120, unit: 'cm', comparator: '>=', status: 'fail' }}
          comfort_note="Schrittmaß 2×17,6 + 28 = 63,2 cm — innerhalb der Komfortregel (59–65 cm)."
          reference={OIB4}
        />
      </Section>

      <Section id="dimension_diagram_door">
        <DimensionDiagramCard
          title="Türe – lichte Durchgangsbreite"
          shape="door"
          dimensions={[
            { label: 'lichte Durchgangsbreite', value: 85, required: 80, unit: 'cm', comparator: '>=', status: 'pass' },
            { label: 'Durchgangshöhe', value: 210, required: 200, unit: 'cm', comparator: '>=', status: 'pass' },
          ]}
          reference={{ document: 'ÖNORM B 1600', section: 'Pkt. 5.1.1' }}
        />
      </Section>

      {/* The legend at its most crowded, which is the state worth having on
          film: a measured value with its ± band, the „gemessen" provenance chip
          and the limit all in one `text-xs` row, plus the unanswerable check
          that prints the CAD remedy and offers the „Dazu fragen" chip. */}
      <Section id="dimension_diagram_ramp">
        <DimensionDiagramCard
          title="Rampe – Neigung & Breite"
          shape="ramp"
          dimensions={[
            {
              label: 'Neigung',
              value: 7.2,
              required: 6,
              unit: '%',
              comparator: '<=',
              status: 'fail',
              provenance: 'computed',
              tolerance: 0.1,
            },
            {
              label: 'nutzbare Breite',
              value: 120,
              required: 120,
              unit: 'cm',
              comparator: '>=',
              status: 'pass',
              provenance: 'declared',
            },
            {
              label: 'Handlauf beidseitig',
              value: null,
              unit: 'cm',
              status: 'needs_input',
              missing: 'Dieser Export enthält kein IfcRailing — Handläufe im CAD als IfcRailing modellieren.',
            },
          ]}
          reference={{ document: 'ÖNORM B 1600', section: 'Pkt. 5.2' }}
        />
      </Section>

      <Section id="dimension_diagram_turning_circle">
        <DimensionDiagramCard
          title="Wendekreis Rollstuhl"
          shape="turning_circle"
          dimensions={[
            { label: 'Durchmesser', value: 150, required: 150, unit: 'cm', comparator: '>=', status: 'pass' },
          ]}
          reference={{ document: 'ÖNORM B 1600' }}
        />
      </Section>

      {/* The three remaining shapes, so the gallery photographs every template
          the renderer can produce rather than half of them: a corridor plan, a
          threshold detail at centimetre scale, and a parking bay in plan. */}
      <Section id="dimension_diagram_corridor">
        <DimensionDiagramCard
          title="Gang – nutzbare Breite"
          shape="corridor"
          dimensions={[
            { label: 'nutzbare Breite', value: 110, required: 120, unit: 'cm', comparator: '>=', status: 'fail' },
          ]}
          reference={{ document: 'ÖNORM B 1600', section: 'Pkt. 4.2' }}
        />
      </Section>

      <Section id="dimension_diagram_threshold">
        <DimensionDiagramCard
          title="Türschwelle – Anschlaghöhe"
          shape="threshold"
          dimensions={[
            { label: 'Schwellenhöhe', value: 2, required: 2, unit: 'cm', comparator: '<=', status: 'pass' },
          ]}
          reference={{ document: 'ÖNORM B 1600', section: 'Pkt. 5.1.3' }}
        />
      </Section>

      <Section id="dimension_diagram_parking_space">
        <DimensionDiagramCard
          title="Stellplatz barrierefrei"
          shape="parking_space"
          dimensions={[
            { label: 'Breite', value: 350, required: 350, unit: 'cm', comparator: '>=', status: 'pass' },
            { label: 'Länge', value: 500, required: 500, unit: 'cm', comparator: '>=', status: 'pass' },
          ]}
          reference={{ document: 'ÖNORM B 1600', section: 'Pkt. 3.3' }}
        />
      </Section>

      <Section id="setback_plan">
        <SetbackPlanCard
          title="Abstandsflächen – Lageplan"
          parcel_width_m={22}
          parcel_depth_m={30}
          building_width_m={12}
          building_depth_m={14}
          sides={[
            { side: 'left', required_m: 3, actual_m: 2.4, status: 'fail' },
            { side: 'right', required_m: 3, actual_m: 4.2, status: 'pass' },
            { side: 'front', required_m: 5, actual_m: 6.0, status: 'pass' },
            { side: 'back', required_m: 3, actual_m: null, status: 'needs_input' },
          ]}
          reference={{ document: 'NÖ Bauordnung 2014', section: '§ 54' }}
        />
      </Section>

      <Section id="egress_diagram">
        <EgressDiagramCard
          title="Fluchtweg – Gehweglänge"
          segments={[
            { label: 'Raum → Gang', length_m: 12, turn: 'right' },
            { label: 'Gang', length_m: 18, turn: 'left' },
            { label: 'Gang → Treppenhaus', length_m: 8, turn: 'straight' },
          ]}
          total_length={{ label: 'Gehweglänge gesamt', value: 38, required: 40, unit: 'm', comparator: '<=', status: 'pass' }}
          reference={OIB2}
        />
      </Section>

      <Section id="daylight_incidence">
        <DaylightIncidenceCard
          title="Belichtung – freier Lichteinfall"
          room_floor_area_m2={22}
          glass_area={{ label: 'Lichteintrittsfläche', value: 2.6, required: 2.2, unit: 'm²', comparator: '>=', status: 'pass' }}
          window_sill_height_m={1.0}
          window_head_height_m={2.4}
          obstruction={{ distance_m: 6, height_m: 7.5, label: 'Gegenüberliegendes Gebäude' }}
          reference={OIB3}
        />
      </Section>

      <Section id="guardrail_check">
        <GuardrailCheckCard
          title="Absturzsicherung Dachterrasse"
          context="roof_terrace"
          fall_height={{ label: 'Absturzhöhe', value: 13.5, required: 12, unit: 'm', comparator: '<=', status: 'warning' }}
          rail_height={{ label: 'Geländerhöhe', value: 100, required: 110, unit: 'cm', comparator: '>=', status: 'fail' }}
          max_opening={{ label: 'max. Öffnungsweite', value: 11, required: 12, unit: 'cm', comparator: '<=', status: 'pass' }}
          bottom_gap={{ label: 'Bodenspalt', value: 3, required: 12, unit: 'cm', comparator: '<=', status: 'pass' }}
          has_horizontal_elements_in_climb_zone={false}
          reference={OIB4}
        />
      </Section>

      <Section id="fire_access_plan">
        <FireAccessPlanCard
          title="Feuerwehrzufahrt & Aufstellfläche"
          parcel_width_m={28}
          parcel_depth_m={36}
          building_width_m={16}
          building_depth_m={14}
          route_width={{ label: 'Zufahrt Breite', value: 3.5, required: 3, unit: 'm', comparator: '>=', status: 'pass' }}
          gate_clearance_height={{ label: 'Durchfahrt lichte Höhe', value: 4.0, required: 4.0, unit: 'm', comparator: '>=', status: 'pass' }}
          staging_area={{
            width: { label: 'Breite', value: 5, required: 5, unit: 'm', comparator: '>=', status: 'pass' },
            length: { label: 'Länge', value: 11, required: 10, unit: 'm', comparator: '>=', status: 'pass' },
            distance_to_facade: { label: 'Abstand zur Fassade', value: 3, required: 10, unit: 'm', comparator: '<=', status: 'pass' },
          }}
          walk_distance_to_entrance={{ label: 'Weg zum Eingang', value: 34, required: 80, unit: 'm', comparator: '<=', status: 'pass' }}
          building_class="GK 4"
          reference={{ document: 'TRVB F 134', section: 'Pkt. 4' }}
        />
      </Section>
    </>
  )
}
