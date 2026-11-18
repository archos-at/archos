import type { ProjectIntakeStage } from '../intake-types'

export const CONTEXT_STAGE: ProjectIntakeStage = {
  id: 'G',
  title: 'Projektkontext',
  scope: 'project',
  description:
    'Geführter Freitext: alles, was der Assistent über die Zahlen hinaus wissen sollte. Alle Felder optional — je mehr Kontext, desto besser.',
  questions: [
    {
      id: 'G1',
      core: true,
      label: 'Projektbeschreibung, Entwurfsidee & Umfeld',
      type: 'textarea',
      optional: true,
      placeholder:
        'Was ist das Projekt in 3–10 Sätzen? Städtebauliche Setzung, Konzept, Materialität, Besonderheiten von Grundstück und Nachbarschaft …',
      writesTo: '/facts/context_description/value',
    },
    {
      id: 'G2',
      label: 'Ziele & Prioritäten der Bauherrschaft',
      type: 'textarea',
      optional: true,
      placeholder:
        'Kosten- und Terminrahmen, Nachhaltigkeitsambition, Flexibilität, besondere Wünsche …',
      writesTo: '/facts/context_goals/value',
    },
    {
      id: 'G3',
      label: 'Bekannte Konfliktpunkte & Risiken',
      type: 'textarea',
      optional: true,
      placeholder: 'Nachbarn, Behördenvorgespräche, technische Risiken, Widmungskonflikte …',
      writesTo: '/facts/context_conflicts/value',
    },
    {
      id: 'G4',
      label: 'Sonderlösungen, Abweichungen & Sonstiges',
      type: 'textarea',
      optional: true,
      placeholder:
        'Geplante Abweichungen (z. B. Brandschutzkonzept mit Kompensation) und alles Weitere für den Assistenten.',
      writesTo: '/facts/context_special_solutions/value',
    },
  ],
}
