export const SCRAPE_ANNOTATION = {
  scrape: "prometheus.io/scrape",
  port: "prometheus.io/port",
  path: "prometheus.io/path",
} as const;

export function scrapeAnnotations(port: number, path = "/metrics"): Record<string, string> {
  return { [SCRAPE_ANNOTATION.scrape]: "true", [SCRAPE_ANNOTATION.port]: String(port), [SCRAPE_ANNOTATION.path]: path };
}
