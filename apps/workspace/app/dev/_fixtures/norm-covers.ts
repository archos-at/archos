import { buildPdf, type PdfLine } from './sample-pdf'

export interface NormCover {
  fileName: string
  pages: readonly (readonly PdfLine[])[]
}

const ONORM_B_1600_COVER: readonly PdfLine[] = [
  ['ÖNORM B 1600', 22, true],
  ['Ausgabe: 2023-02-01', 10, false],
  ['', 10, false],
  ['Barrierefreies Bauen - Planungsgrundlagen', 14, true],
  ['Barrier-free design - Planning principles', 10, false],
  ['Normengruppe B', 9, false],
  ['Ersatz für ÖNORM B 1600:2017-04-01 und', 9, false],
  ['ÖNORM B 1601:2003-02-01', 9, false],
  ['ICS 11.180.01; 91.010.30', 9, false],
]

const BODY: readonly PdfLine[] = [
  ['1 Anwendungsbereich', 12, true],
  ['Diese Norm gilt für die Planung barrierefreier Gebäude.', 10, false],
]

export const NORM_COVERS = {
  onorm: { fileName: 'OENORM_B_1600_2023-02-01.pdf', pages: [ONORM_B_1600_COVER, BODY] },
  en: {
    fileName: 'EN_1990_Eurocode.pdf',
    pages: [
      [
        ['EUROPEAN STANDARD', 10, true],
        ['NORME EUROPÉENNE', 10, true],
        ['EUROPÄISCHE NORM', 10, true],
        ['EN 1990', 20, true],
        ['April 2002', 10, false],
        ['ICS 91.010.30', 9, false],
        ['Supersedes ENV 1991-1:1994', 9, false],
        ['English version', 9, false],
        ['Eurocode - Basis of structural design', 14, true],
      ],
    ],
  },
  directive: {
    fileName: 'MA37_Weisung_Dachgeschoss.pdf',
    pages: [
      [
        ['Magistrat der Stadt Wien', 10, false],
        ['MA 37 - Baupolizei', 10, true],
        ['Weisung', 18, true],
        ['Betreff: Dachgeschossausbau in Bestandsgebäuden', 11, false],
        ['Wien, am 15. März 2024', 10, false],
      ],
    ],
  },
  scan: { fileName: 'OENORM_B_1300_2012.pdf', pages: [[], []] },
  imageCover: { fileName: 'OENORM_B_1600.pdf', pages: [[], ONORM_B_1600_COVER] },
  disagrees: { fileName: 'OENORM_B1600_2017-04-01.pdf', pages: [ONORM_B_1600_COVER, BODY] },
} satisfies Record<string, NormCover>

export const normCoverPdf = (cover: NormCover): Uint8Array<ArrayBuffer> => buildPdf(cover.pages)

export const normCoverFile = (cover: NormCover, fileName: string = cover.fileName): File =>
  new File([normCoverPdf(cover)], fileName, { type: 'application/pdf' })
