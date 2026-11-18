import Decimal from "decimal.js";

export default function () {
  const site = new Decimal("812.40");
  const storeys = [
    { storey: "EG", gross: new Decimal("198.35") },
    { storey: "OG", gross: new Decimal("198.35") },
    { storey: "DG", gross: new Decimal("142.80") },
  ];
  const grossTotal = storeys.reduce((sum, s) => sum.plus(s.gross), new Decimal(0));
  const ratio = grossTotal.dividedBy(site);
  return {
    inputs: { site: site.toNumber(), storeys: storeys.map((s) => ({ storey: s.storey, gross: s.gross.toNumber() })) },
    steps: [
      { what: "gross floor area", formula: storeys.map((s) => s.gross.toString()).join(" + "), value: grossTotal.toNumber() },
      { what: "floor area ratio", formula: `${grossTotal} / ${site}`, value: ratio.toNumber() },
    ],
    result: { grossTotal: grossTotal.toNumber(), ratio: ratio.toDecimalPlaces(2).toNumber() },
  };
}
